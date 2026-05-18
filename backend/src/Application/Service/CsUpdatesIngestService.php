<?php
declare(strict_types=1);

namespace App\Application\Service;

use App\Infrastructure\External\SteamNewsClient;
use App\Infrastructure\Persistence\Repository\CsUpdatesFeedRepository;

final class CsUpdatesIngestService
{
    public function __construct(
        private readonly SteamNewsClient $steamNewsClient,
        private readonly CsUpdatesFeedRepository $repository
    ) {
    }

    /**
     * @return array{sourceUrl:string,totalEntries:int,insertedCount:int,updatedCount:int,skippedCount:int}
     */
    public function ingest(): array
    {
        $this->repository->ensureTable();
        $newsItems = $this->steamNewsClient->fetchNewsItems();
        $entries = $this->mapNewsItemsToEntries($newsItems);

        $inserted = 0;
        $updated = 0;
        $skipped = 0;

        foreach ($entries as $entry) {
            if (trim((string) ($entry['external_id'] ?? '')) === '') {
                $skipped++;
                continue;
            }

            $exists = $this->repository->findByExternalId((string) $entry['external_id']);
            $isInserted = $this->repository->upsert($entry);

            if ($isInserted || $exists === null) {
                $inserted++;
            } else {
                $updated++;
            }
        }

        return [
            'sourceUrl' => $this->steamNewsClient->resolveEndpointUrl(),
            'totalEntries' => count($entries),
            'insertedCount' => $inserted,
            'updatedCount' => $updated,
            'skippedCount' => $skipped,
        ];
    }

    /**
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

            $publishedAt = $this->parsePublishedAt($dateUnix);
            $meta = $this->extractSteamMeta($title . "\n" . $contents);
            $externalId = $gid !== ''
                ? $gid
                : sha1($link . '|' . $publishedAt->format(DATE_ATOM) . '|' . $title);
            $summary = $this->buildSummary($contents);

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

    private function parsePublishedAt(int $unixTimestamp): \DateTimeImmutable
    {
        if ($unixTimestamp > 0) {
            return (new \DateTimeImmutable('@' . $unixTimestamp))->setTimezone(new \DateTimeZone('UTC'));
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

    private function buildSummary(string $contents): string
    {
        if ($contents === '') {
            return '';
        }

        $plain = trim(preg_replace('/\s+/', ' ', strip_tags($contents)) ?? '');
        if ($plain === '') {
            return '';
        }

        if (mb_strlen($plain) <= 420) {
            return $plain;
        }

        return rtrim(mb_substr($plain, 0, 420)) . '…';
    }
}
