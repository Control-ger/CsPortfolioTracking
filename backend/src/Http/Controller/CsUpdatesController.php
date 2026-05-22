<?php
declare(strict_types=1);

namespace App\Http\Controller;

use App\Infrastructure\Persistence\Repository\CsUpdatesFeedRepository;
use App\Shared\Http\JsonResponseFactory;
use App\Shared\Http\Request;
use Throwable;

final class CsUpdatesController
{
    public function __construct(private readonly CsUpdatesFeedRepository $repository)
    {
    }

    public function list(Request $request): void
    {
        try {
            $limit = isset($request->query['limit']) && is_numeric($request->query['limit'])
                ? (int) $request->query['limit']
                : 50;
            $before = isset($request->query['before']) ? (string) $request->query['before'] : null;

            $rows = $this->repository->listLatest($limit, $before);
            $items = array_map([$this, 'mapRowToApiItem'], $rows);
            $lastItem = end($items);
            $nextBefore = is_array($lastItem) ? ($lastItem['publishedAt'] ?? null) : null;

            JsonResponseFactory::success(
                [
                    'items' => $items,
                ],
                [
                    'fetchedAt' => gmdate(DATE_ATOM),
                    'sourceMode' => 'backend',
                    'nextBefore' => $nextBefore,
                    'staleAfterSeconds' => 120,
                    'isStale' => false,
                ]
            );
        } catch (Throwable $exception) {
            JsonResponseFactory::error('CS_UPDATES_LIST_FAILED', $exception->getMessage(), [], 500);
        }
    }

    /**
     * @param array<string,mixed> $row
     * @return array<string,mixed>
     */
    private function mapRowToApiItem(array $row): array
    {
        $publishedAt = (string) ($row['published_at'] ?? '');
        $publishedIso = $publishedAt !== ''
            ? (new \DateTimeImmutable($publishedAt, new \DateTimeZone('UTC')))->format(DATE_ATOM)
            : gmdate(DATE_ATOM);
        $summary = $this->sanitizeFeedText((string) ($row['summary_raw'] ?? ''));
        $title = $this->sanitizeFeedText((string) ($row['title'] ?? ''));

        return [
            'id' => (string) ($row['id'] ?? ''),
            'source' => (string) ($row['source'] ?? 'steam_news_api'),
            'sourceLabel' => $this->resolveSourceLabel((string) ($row['source'] ?? 'steam_news_api')),
            'title' => $title !== '' ? $title : 'CS2 Update',
            'summary' => $summary !== '' ? $summary : 'Neue Aenderung in Counter-Strike 2 erkannt.',
            'details' => $summary !== '' ? $summary : 'Keine weiteren Details verfuegbar.',
            'url' => (string) ($row['url'] ?? ''),
            'publishedAt' => $publishedIso,
            'updatedAt' => $publishedIso,
            'severity' => 'info',
            'tags' => array_values(array_filter([
                isset($row['branch']) && trim((string) $row['branch']) !== '' ? 'branch:' . trim((string) $row['branch']) : null,
                isset($row['build_id']) && (int) $row['build_id'] > 0 ? 'build:' . (string) (int) $row['build_id'] : null,
                isset($row['changelist_id']) && (int) $row['changelist_id'] > 0 ? 'changelist:' . (string) (int) $row['changelist_id'] : null,
            ])),
            'highlights' => array_values(array_filter([
                isset($row['changelist_id']) && (int) $row['changelist_id'] > 0 ? 'Changelist #' . (int) $row['changelist_id'] : null,
                isset($row['build_id']) && (int) $row['build_id'] > 0 ? 'Build ' . (int) $row['build_id'] : null,
                isset($row['branch']) && trim((string) $row['branch']) !== '' ? 'Branch: ' . trim((string) $row['branch']) : null,
            ])),
            'changelistId' => isset($row['changelist_id']) ? (int) $row['changelist_id'] : null,
            'buildId' => isset($row['build_id']) ? (int) $row['build_id'] : null,
            'branch' => isset($row['branch']) ? (string) $row['branch'] : null,
        ];
    }

    private function resolveSourceLabel(string $source): string
    {
        return match (strtolower(trim($source))) {
            'steamdb_rss' => 'SteamDB RSS',
            'steam_news_api' => 'Steam News',
            default => 'CS Feed',
        };
    }

    private function sanitizeFeedText(string $text): string
    {
        if (trim($text) === '') {
            return '';
        }

        $normalized = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $normalized = preg_replace('/\[img\].*?\[\/img\]/is', ' ', $normalized) ?? $normalized;
        $normalized = preg_replace('/\[url=([^\]]+)\](.*?)\[\/url\]/is', '$2', $normalized) ?? $normalized;
        $normalized = preg_replace('/\[url\](.*?)\[\/url\]/is', '$1', $normalized) ?? $normalized;
        $normalized = preg_replace('/\[\*\]/', ' - ', $normalized) ?? $normalized;
        $normalized = preg_replace('/\[(?:\/)?(?:p|h1|h2|h3|b|i|u|list|quote|code)\]/i', ' ', $normalized) ?? $normalized;
        $normalized = preg_replace('/\[(?:\/)?[a-z0-9_*]+(?:=[^\]]+)?\]/i', ' ', $normalized) ?? $normalized;

        return trim(preg_replace('/\s+/', ' ', strip_tags($normalized)) ?? '');
    }
}
