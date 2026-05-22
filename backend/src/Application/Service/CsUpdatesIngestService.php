<?php
declare(strict_types=1);

namespace App\Application\Service;

use App\Infrastructure\External\SteamDbRssClient;
use App\Infrastructure\External\SteamNewsClient;
use App\Infrastructure\Persistence\Repository\CsUpdatesFeedRepository;
use App\Infrastructure\Persistence\Repository\WebPushSubscriptionRepository;
use Throwable;

final class CsUpdatesIngestService
{
    public function __construct(
        private readonly SteamDbRssClient $steamDbRssClient,
        private readonly SteamNewsClient $steamNewsClient,
        private readonly CsUpdatesFeedRepository $repository,
        private readonly ?WebPushSubscriptionRepository $webPushSubscriptionRepository = null,
        private readonly ?WebPushService $webPushService = null
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

        try {
            $rssItems = $this->steamDbRssClient->fetchItems();
            $entries = $this->mapRssItemsToEntries($rssItems);
            $sourceUrl = $this->steamDbRssClient->resolveRssUrl();
        } catch (Throwable) {
            $entries = [];
        }

        if (count($entries) === 0) {
            $newsItems = $this->steamNewsClient->fetchNewsItems();
            $entries = $this->mapNewsItemsToEntries($newsItems);
            $sourceUrl = $this->steamNewsClient->resolveEndpointUrl();
        }

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
                $this->notifyWebPushSubscribers($entry);
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
            $summary = $this->buildSummary($description);

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

        return rtrim(mb_substr($plain, 0, 420)) . '...';
    }

    /**
     * @param array<string,mixed> $entry
     */
    private function notifyWebPushSubscribers(array $entry): void
    {
        if (!$this->webPushSubscriptionRepository instanceof WebPushSubscriptionRepository) {
            return;
        }

        if (!$this->webPushService instanceof WebPushService || !$this->webPushService->isConfigured()) {
            return;
        }

        $subscriptions = $this->webPushSubscriptionRepository->listActive(1200);
        foreach ($subscriptions as $subscription) {
            $endpoint = trim((string) ($subscription['endpoint'] ?? ''));
            if ($endpoint === '') {
                continue;
            }

            $result = $this->webPushService->sendWakeup($endpoint, 180);
            if ($result['ok'] === true) {
                $this->webPushSubscriptionRepository->markDeliverySuccess($endpoint);
                continue;
            }

            $statusCode = (int) ($result['statusCode'] ?? 0);
            $deactivate = in_array($statusCode, [404, 410], true);
            $this->webPushSubscriptionRepository->markDeliveryFailure($endpoint, $deactivate);
        }
    }
}
