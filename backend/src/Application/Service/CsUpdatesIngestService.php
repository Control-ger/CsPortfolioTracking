<?php
declare(strict_types=1);

namespace App\Application\Service;

use App\Infrastructure\External\SteamDbPatchnotesClient;
use App\Infrastructure\External\SteamDbRssClient;
use App\Infrastructure\External\SteamNewsClient;
use App\Infrastructure\Persistence\Repository\CsUpdatesFeedRepository;
use Throwable;

final class CsUpdatesIngestService
{
    public function __construct(
        private readonly SteamDbRssClient $steamDbRssClient,
        private readonly SteamNewsClient $steamNewsClient,
        private readonly CsUpdatesFeedRepository $repository,
        private readonly ?SteamDbPatchnotesClient $steamDbPatchnotesClient = null
    ) {
    }

    /**
     * @return array{sourceUrl:string,totalEntries:int,insertedCount:int,updatedCount:int,skippedCount:int}
     */
    public function ingest(): array
    {
        $this->repository->ensureTable();

        $entries = [];
        $sourceUrl = '';
        $steamNewsItems = [];

        try {
            $rssItems = $this->steamDbRssClient->fetchItems();
            $entries = $this->mapRssItemsToEntries($rssItems);
            $sourceUrl = $this->steamDbRssClient->resolveRssUrl();
        } catch (Throwable) {
            $entries = [];
        }

        if (count($entries) === 0) {
            $steamNewsItems = $this->steamNewsClient->fetchNewsItems();
            $entries = $this->mapNewsItemsToEntries($steamNewsItems);
            $sourceUrl = $this->steamNewsClient->resolveEndpointUrl();
        } else {
            try {
                $steamNewsItems = $this->steamNewsClient->fetchNewsItems();
            } catch (Throwable) {
                $steamNewsItems = [];
            }
        }

        [$newsByBuildId, $newsByTitleKey] = $this->buildSteamNewsEnrichmentIndexes($steamNewsItems);
        $enrichmentBudget = $this->resolveEnrichmentBudget();

        $inserted = 0;
        $updated = 0;
        $skipped = 0;

        foreach ($entries as $entry) {
            if (trim((string) ($entry['external_id'] ?? '')) === '') {
                $skipped++;
                continue;
            }

            $exists = $this->repository->findByExternalId((string) $entry['external_id']);
            if ($this->shouldEnrichEntry($entry, $exists, $newsByBuildId, $newsByTitleKey)) {
                $canFetchPatchnotes = $enrichmentBudget > 0;
                $enrichmentResult = $this->enrichEntrySummary(
                    $entry,
                    $newsByBuildId,
                    $newsByTitleKey,
                    $canFetchPatchnotes
                );
                $entry = $enrichmentResult['entry'];
                if (($enrichmentResult['usedPatchnotesFetch'] ?? false) === true) {
                    $enrichmentBudget = max(0, $enrichmentBudget - 1);
                }
            }

            $isInserted = $this->repository->upsert($entry);

            if ($isInserted || $exists === null) {
                $inserted++;
                // Web-push wakeups are fired only from CsUpdatesAiRatingService, once
                // the AI impact rating is known, so the per-user min-level filter can
                // be honoured. Firing here (impact still unknown) would both bypass
                // that filter and double-notify.
            } else {
                $updated++;
            }
        }

        return [
            'sourceUrl' => $sourceUrl,
            'totalEntries' => count($entries),
            'insertedCount' => $inserted,
            'updatedCount' => $updated,
            'skippedCount' => $skipped,
        ];
    }

    /**
     * @param array<int,array<string,mixed>> $newsItems
     * @return array<int,array<string,mixed>>
     */
    private function mapNewsItemsToEntries(array $newsItems): array
    {
        $items = [];

        foreach ($newsItems as $item) {
            $title = trim((string) ($item['title'] ?? ''));
            $link = trim((string) ($item['url'] ?? ''));
            $gid = trim((string) ($item['gid'] ?? ''));
            $contents = trim((string) ($item['contents'] ?? ''));
            $feedLabel = trim((string) ($item['feedlabel'] ?? ''));
            $dateUnix = isset($item['date']) ? (int) $item['date'] : 0;

            if ($title === '' && $link === '') {
                continue;
            }

            $publishedAt = $this->parsePublishedAtUnix($dateUnix);
            $meta = $this->extractSteamMeta($title . "\n" . $contents);
            $externalId = $gid !== ''
                ? $gid
                : sha1($link . '|' . $publishedAt->format(DATE_ATOM) . '|' . $title);
            $summary = $this->buildSummary($contents, $this->resolveSummaryMaxLength());

            $items[] = [
                'source' => 'steam_news_api',
                'external_id' => $externalId,
                'title' => $title !== '' ? $title : 'CS2 Update',
                'url' => $link !== '' ? $link : 'https://www.counter-strike.net/news/',
                'summary_raw' => $summary !== '' ? $summary : $feedLabel,
                'published_at' => $publishedAt->format('Y-m-d H:i:s'),
                'changelist_id' => $meta['changelist_id'],
                'build_id' => $meta['build_id'],
                'branch' => $meta['branch'],
            ];
        }

        usort($items, static fn(array $a, array $b): int => strcmp((string) $b['published_at'], (string) $a['published_at']));

        return $items;
    }

    /**
     * @param array<int,array<string,string>> $rssItems
     * @return array<int,array<string,mixed>>
     */
    private function mapRssItemsToEntries(array $rssItems): array
    {
        $items = [];

        foreach ($rssItems as $item) {
            $title = trim((string) ($item['title'] ?? ''));
            $link = trim((string) ($item['link'] ?? ''));
            $guid = trim((string) ($item['guid'] ?? ''));
            $description = trim((string) ($item['description'] ?? ''));
            $pubDate = trim((string) ($item['pubDate'] ?? ''));

            if ($title === '' && $link === '') {
                continue;
            }

            $publishedAt = $this->parsePublishedAtDateString($pubDate);
            $meta = $this->extractSteamMeta($title . "\n" . $description);
            $externalId = $guid !== ''
                ? $guid
                : sha1($link . '|' . $publishedAt->format(DATE_ATOM) . '|' . $title);
            $summary = $this->buildSummary($description, min(1200, $this->resolveSummaryMaxLength()));

            $items[] = [
                'source' => 'steamdb_rss',
                'external_id' => $externalId,
                'title' => $title !== '' ? $title : 'CS2 Update',
                'url' => $link !== '' ? $link : 'https://steamdb.info/app/730/patchnotes/',
                'summary_raw' => $summary !== '' ? $summary : $description,
                'published_at' => $publishedAt->format('Y-m-d H:i:s'),
                'changelist_id' => $meta['changelist_id'],
                'build_id' => $meta['build_id'],
                'branch' => $meta['branch'],
            ];
        }

        usort($items, static fn(array $a, array $b): int => strcmp((string) $b['published_at'], (string) $a['published_at']));

        return $items;
    }

    private function parsePublishedAtUnix(int $unixTimestamp): \DateTimeImmutable
    {
        if ($unixTimestamp > 0) {
            return (new \DateTimeImmutable('@' . $unixTimestamp))->setTimezone(new \DateTimeZone('UTC'));
        }

        return new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
    }

    private function parsePublishedAtDateString(string $dateValue): \DateTimeImmutable
    {
        $timestamp = strtotime($dateValue);
        if ($timestamp !== false && $timestamp > 0) {
            return (new \DateTimeImmutable('@' . $timestamp))->setTimezone(new \DateTimeZone('UTC'));
        }

        return new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
    }

    /**
     * @return array{changelist_id:?int,build_id:?int,branch:?string}
     */
    private function extractSteamMeta(string $text): array
    {
        $normalized = preg_replace('/\s+/', ' ', $text) ?? $text;

        $changelistId = null;
        if (preg_match('/changelist\s*#?\s*(\d{5,})/i', $normalized, $matches) === 1) {
            $changelistId = (int) $matches[1];
        }

        $buildId = null;
        if (preg_match('/build\s*(\d{5,})/i', $normalized, $matches) === 1) {
            $buildId = (int) $matches[1];
        }

        $branch = null;
        if (preg_match('/\(([^()]*?)\s*,\s*build\s*\d{5,}\)/i', $normalized, $matches) === 1) {
            $candidate = strtolower(trim((string) $matches[1]));
            $branch = $candidate !== '' ? substr($candidate, 0, 64) : null;
        }

        return [
            'changelist_id' => $changelistId,
            'build_id' => $buildId,
            'branch' => $branch,
        ];
    }

    /**
     * @param array<int,array<string,mixed>> $newsItems
     * @return array{0:array<int,string>,1:array<string,string>}
     */
    private function buildSteamNewsEnrichmentIndexes(array $newsItems): array
    {
        $byBuildId = [];
        $byTitleKey = [];

        foreach ($newsItems as $item) {
            $title = trim((string) ($item['title'] ?? ''));
            $contents = trim((string) ($item['contents'] ?? ''));
            $combined = $title . "\n" . $contents;
            $meta = $this->extractSteamMeta($combined);
            $summary = $this->buildSummary($contents, 2200);
            if ($summary === '') {
                continue;
            }

            $buildId = isset($meta['build_id']) ? (int) ($meta['build_id'] ?? 0) : 0;
            if ($buildId > 0) {
                $byBuildId[$buildId] = $summary;
            }

            $titleKey = $this->toTitleKey($title);
            if ($titleKey !== '' && (!isset($byTitleKey[$titleKey]) || strlen($byTitleKey[$titleKey]) < strlen($summary))) {
                $byTitleKey[$titleKey] = $summary;
            }
        }

        return [$byBuildId, $byTitleKey];
    }

    /**
     * @param array<string,mixed> $entry
     * @param array<string,mixed>|null $existingRow
     * @param array<int,string> $newsByBuildId
     * @param array<string,string> $newsByTitleKey
     */
    private function shouldEnrichEntry(array $entry, ?array $existingRow, array $newsByBuildId, array $newsByTitleKey): bool
    {
        $source = strtolower(trim((string) ($entry['source'] ?? '')));
        if ($source !== 'steamdb_rss') {
            return false;
        }

        $summary = trim((string) ($entry['summary_raw'] ?? ''));
        if ($this->isSummaryThin($summary)) {
            return true;
        }

        $buildId = isset($entry['build_id']) ? (int) ($entry['build_id'] ?? 0) : 0;
        if ($buildId > 0 && isset($newsByBuildId[$buildId])) {
            return true;
        }

        $titleKey = $this->toTitleKey((string) ($entry['title'] ?? ''));
        if ($titleKey !== '' && isset($newsByTitleKey[$titleKey])) {
            return true;
        }

        if ($existingRow === null) {
            return true;
        }

        $existingSummary = trim((string) ($existingRow['summary_raw'] ?? ''));
        return $this->isSummaryThin($existingSummary);
    }

    /**
     * @param array<string,mixed> $entry
     * @param array<int,string> $newsByBuildId
     * @param array<string,string> $newsByTitleKey
     * @return array{entry:array<string,mixed>,usedPatchnotesFetch:bool}
     */
    private function enrichEntrySummary(array $entry, array $newsByBuildId, array $newsByTitleKey, bool $allowPatchnotesFetch): array
    {
        $summaryMaxLength = $this->resolveSummaryMaxLength();
        $baseSummary = trim((string) ($entry['summary_raw'] ?? ''));
        $candidates = [];
        if ($baseSummary !== '') {
            $candidates[] = $baseSummary;
        }

        $buildId = isset($entry['build_id']) ? (int) ($entry['build_id'] ?? 0) : 0;
        if ($buildId > 0 && isset($newsByBuildId[$buildId])) {
            $candidates[] = $newsByBuildId[$buildId];
        }

        $titleKey = $this->toTitleKey((string) ($entry['title'] ?? ''));
        if ($titleKey !== '' && isset($newsByTitleKey[$titleKey])) {
            $candidates[] = $newsByTitleKey[$titleKey];
        }

        $usedPatchnotesFetch = false;
        $bestBeforePatchnotes = $this->selectBestSummaryCandidate($candidates);

        if (
            $allowPatchnotesFetch
            && $this->steamDbPatchnotesClient instanceof SteamDbPatchnotesClient
            && $this->isSummaryThin($bestBeforePatchnotes)
        ) {
            $url = trim((string) ($entry['url'] ?? ''));
            if ($url !== '') {
                try {
                    $patchnotesText = $this->steamDbPatchnotesClient->fetchSummaryText($url, $summaryMaxLength);
                    if ($patchnotesText !== '') {
                        $candidates[] = $patchnotesText;
                    }
                    $usedPatchnotesFetch = true;
                } catch (Throwable) {
                    $usedPatchnotesFetch = true;
                }
            }
        }

        $finalSummary = $this->selectBestSummaryCandidate($candidates);
        if ($finalSummary !== '') {
            $entry['summary_raw'] = $this->truncate($finalSummary, $summaryMaxLength);
        }

        return [
            'entry' => $entry,
            'usedPatchnotesFetch' => $usedPatchnotesFetch,
        ];
    }

    private function resolveEnrichmentBudget(): int
    {
        $raw = (int) (getenv('CS_UPDATES_ENRICH_MAX_PER_RUN') ?: 3);
        return max(0, min(20, $raw));
    }

    private function resolveSummaryMaxLength(): int
    {
        $raw = (int) (getenv('CS_UPDATES_SUMMARY_MAX_LENGTH') ?: 5000);
        return max(420, min(12000, $raw));
    }

    private function toTitleKey(string $title): string
    {
        $normalized = strtolower(trim($title));
        if ($normalized === '') {
            return '';
        }
        return preg_replace('/\s+/', ' ', $normalized) ?? $normalized;
    }

    private function isSummaryThin(string $summary): bool
    {
        $normalized = strtolower(trim($summary));
        if ($normalized === '') {
            return true;
        }
        if (strlen($normalized) < 120) {
            return true;
        }
        if (preg_match('/^steamdb build \d+/i', $normalized) === 1) {
            return true;
        }
        if (preg_match('/^counter-strike 2 update \(steamdb build \d+\)/i', $normalized) === 1) {
            return true;
        }
        return false;
    }

    /**
     * @param array<int,string> $candidates
     */
    private function selectBestSummaryCandidate(array $candidates): string
    {
        $best = '';
        $bestScore = 0;

        foreach ($candidates as $candidate) {
            $normalized = $this->normalizeText($candidate);
            if ($normalized === '') {
                continue;
            }

            $lengthScore = min(strlen($normalized), 2600);
            $keywordScore = preg_match('/\b(sticker|souvenir|capsule|trade|case|major|market|map|weapon|fixed|release)\b/i', $normalized) === 1
                ? 240
                : 0;
            $score = $lengthScore + $keywordScore;

            if ($score > $bestScore) {
                $best = $normalized;
                $bestScore = $score;
            }
        }

        return $best;
    }

    private function normalizeText(string $text): string
    {
        $normalized = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');

        // Steam news often contains BBCode-style tags ([p], [list], [*], [img], ...).
        // Strip/normalize them so feed entries stay readable in the UI.
        $normalized = preg_replace('/\[img\].*?\[\/img\]/is', "\n", $normalized) ?? $normalized;
        $normalized = preg_replace('/\[url=([^\]]+)\](.*?)\[\/url\]/is', '$2', $normalized) ?? $normalized;
        $normalized = preg_replace('/\[url\](.*?)\[\/url\]/is', '$1', $normalized) ?? $normalized;
        $normalized = preg_replace('/\[\*\]/', "\n- ", $normalized) ?? $normalized;
        $normalized = preg_replace('/\[(?:\/)?(?:p|h1|h2|h3|list|quote|code)\]/i', "\n", $normalized) ?? $normalized;
        $normalized = preg_replace('/\[(?:\/)?(?:b|i|u)\]/i', '', $normalized) ?? $normalized;
        $normalized = preg_replace('/\[(?:\/)?[a-z0-9_*]+(?:=[^\]]+)?\]/i', ' ', $normalized) ?? $normalized;

        $plain = strip_tags($normalized);
        $plain = str_replace(["\r\n", "\r"], "\n", $plain);
        $plain = preg_replace('/[ \t\f\v]+/', ' ', $plain) ?? $plain;
        $plain = preg_replace('/\s*\n\s*/', "\n", $plain) ?? $plain;
        $plain = preg_replace('/\n{3,}/', "\n\n", $plain) ?? $plain;
        $plain = trim($plain);
        return $plain;
    }

    private function buildSummary(string $contents, int $maxLength = 420): string
    {
        if ($contents === '') {
            return '';
        }

        $plain = $this->normalizeText($contents);
        if ($plain === '') {
            return '';
        }

        if (mb_strlen($plain) <= $maxLength) {
            return $plain;
        }

        return $this->truncate($plain, $maxLength);
    }

    private function truncate(string $text, int $maxLength): string
    {
        if (mb_strlen($text) <= $maxLength) {
            return $text;
        }
        return rtrim(mb_substr($text, 0, $maxLength)) . '...';
    }
}
