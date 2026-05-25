<?php
declare(strict_types=1);

namespace App\Http\Controller;

use App\Infrastructure\Persistence\Repository\CsUpdatesFeedRepository;
use App\Shared\Http\JsonResponseFactory;
use App\Shared\Http\Request;
use Throwable;

final class CsUpdatesController
{
    private const DEFAULT_BANNER_DURATION_HOURS = 168;
    private const MIN_BANNER_DURATION_HOURS = 1;
    private const MAX_BANNER_DURATION_HOURS = 24 * 30;
    private const DEFAULT_FEED_WINDOW_DAYS = 7;

    public function __construct(private readonly CsUpdatesFeedRepository $repository)
    {
    }

    public function list(Request $request): void
    {
        try {
            $limit = isset($request->query['limit']) && is_numeric($request->query['limit'])
                ? (int) $request->query['limit']
                : 30;
            $resolvedLimit = max(1, min(100, $limit));
            $before = isset($request->query['before']) ? (string) $request->query['before'] : null;
            $since = isset($request->query['since']) ? (string) $request->query['since'] : null;
            $beforeUtc = $this->parseDateQueryToUtc($before);
            $sinceUtc = $this->parseDateQueryToUtc($since);

            $rows = $this->repository->listLatest($resolvedLimit + 1, $beforeUtc, $sinceUtc);
            $hasMore = count($rows) > $resolvedLimit;
            $visibleRows = $hasMore ? array_slice($rows, 0, $resolvedLimit) : $rows;
            $items = array_map([$this, 'mapRowToApiItem'], $visibleRows);
            $lastItem = end($items);
            $nextBefore = $hasMore && is_array($lastItem) ? ($lastItem['publishedAt'] ?? null) : null;

            JsonResponseFactory::success(
                [
                    'items' => $items,
                ],
                [
                    'fetchedAt' => gmdate(DATE_ATOM),
                    'sourceMode' => 'backend',
                    'nextBefore' => $nextBefore,
                    'hasMore' => $hasMore,
                    'defaultWindowDays' => self::DEFAULT_FEED_WINDOW_DAYS,
                    'staleAfterSeconds' => 120,
                    'bannerVisibleHours' => $this->resolveBannerDurationHours(),
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
        $details = $this->sanitizeFeedText((string) ($row['summary_raw'] ?? ''));
        $titleRaw = $this->sanitizeFeedText((string) ($row['title'] ?? ''));
        $title = $this->resolveDisplayTitle($titleRaw, $details);
        $summary = $this->buildSummaryPreview($details);
        $aiImpactLevel = $this->normalizeAiImpactLevel($row['ai_impact_level'] ?? null);
        $aiUrgency = $this->normalizeAiUrgency($row['ai_urgency'] ?? null);
        $aiConfidence = $this->normalizeAiConfidence($row['ai_confidence'] ?? null);
        $aiStatus = $this->normalizeAiStatus($row['ai_rating_status'] ?? null);
        $aiRatedAt = isset($row['ai_rated_at']) && trim((string) $row['ai_rated_at']) !== ''
            ? (new \DateTimeImmutable((string) $row['ai_rated_at'], new \DateTimeZone('UTC')))->format(DATE_ATOM)
            : null;
        $aiRecommendedAction = trim((string) ($row['ai_recommended_action'] ?? ''));
        $aiReasoning = trim((string) ($row['ai_reasoning'] ?? ''));
        $aiModel = trim((string) ($row['ai_model'] ?? ''));
        $aiScore = isset($row['ai_impact_score']) ? (int) $row['ai_impact_score'] : null;

        return [
            'id' => (string) ($row['id'] ?? ''),
            'source' => (string) ($row['source'] ?? 'steam_news_api'),
            'sourceLabel' => $this->resolveSourceLabel((string) ($row['source'] ?? 'steam_news_api')),
            'title' => $title !== '' ? $title : 'CS2 Update',
            'summary' => $summary !== '' ? $summary : 'Neue Aenderung in Counter-Strike 2 erkannt.',
            'details' => $details !== '' ? $details : 'Keine weiteren Details verfuegbar.',
            'updateNotes' => $details !== '' ? $details : null,
            'url' => (string) ($row['url'] ?? ''),
            'publishedAt' => $publishedIso,
            'updatedAt' => $publishedIso,
            'severity' => $this->mapSeverityFromAiImpactLevel($aiImpactLevel),
            'tags' => array_values(array_filter([
                isset($row['branch']) && trim((string) $row['branch']) !== '' ? 'branch:' . trim((string) $row['branch']) : null,
                isset($row['build_id']) && (int) $row['build_id'] > 0 ? 'build:' . (string) (int) $row['build_id'] : null,
                isset($row['changelist_id']) && (int) $row['changelist_id'] > 0 ? 'changelist:' . (string) (int) $row['changelist_id'] : null,
                $aiImpactLevel !== null ? 'impact:' . $aiImpactLevel : null,
            ])),
            'highlights' => array_values(array_filter([
                isset($row['changelist_id']) && (int) $row['changelist_id'] > 0 ? 'Changelist #' . (int) $row['changelist_id'] : null,
                isset($row['build_id']) && (int) $row['build_id'] > 0 ? 'Build ' . (int) $row['build_id'] : null,
                isset($row['branch']) && trim((string) $row['branch']) !== '' ? 'Branch: ' . trim((string) $row['branch']) : null,
                $aiRecommendedAction !== '' ? 'Aktion: ' . $aiRecommendedAction : null,
            ])),
            'changelistId' => isset($row['changelist_id']) ? (int) $row['changelist_id'] : null,
            'buildId' => isset($row['build_id']) ? (int) $row['build_id'] : null,
            'branch' => isset($row['branch']) ? (string) $row['branch'] : null,
            'aiRatingStatus' => $aiStatus,
            'aiImpactLevel' => $aiImpactLevel,
            'aiImpactScore' => $aiScore,
            'aiUrgency' => $aiUrgency,
            'aiRecommendedAction' => $aiRecommendedAction !== '' ? $aiRecommendedAction : null,
            'aiReasoning' => $aiReasoning !== '' ? $aiReasoning : null,
            'aiConfidence' => $aiConfidence,
            'aiModel' => $aiModel !== '' ? $aiModel : null,
            'aiRatedAt' => $aiRatedAt,
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

        $plain = strip_tags($normalized);
        $plain = str_replace(["\r\n", "\r"], "\n", $plain);
        $plain = preg_replace('/[ \t\f\v]+/', ' ', $plain) ?? $plain;
        $plain = preg_replace('/\s*\n\s*/', "\n", $plain) ?? $plain;
        $plain = preg_replace('/\n{3,}/', "\n\n", $plain) ?? $plain;
        return trim($plain);
    }

    private function buildSummaryPreview(string $details): string
    {
        $normalized = trim(preg_replace('/\s+/', ' ', $details) ?? '');
        if ($normalized === '') {
            return '';
        }

        if (mb_strlen($normalized) <= 260) {
            return $normalized;
        }

        return rtrim(mb_substr($normalized, 0, 260)) . '...';
    }

    private function resolveDisplayTitle(string $title, string $details): string
    {
        $normalizedTitle = strtolower(trim($title));
        $isGenericTitle = $normalizedTitle === ''
            || str_starts_with($normalizedTitle, 'counter-strike 2 update for')
            || $normalizedTitle === 'counter-strike 2 update'
            || $normalizedTitle === 'cs2 update';

        if (!$isGenericTitle) {
            return $title;
        }

        $detailLines = preg_split('/\n+/', trim($details)) ?: [];
        foreach ($detailLines as $line) {
            $candidate = trim((string) $line);
            if ($candidate === '') {
                continue;
            }

            if (mb_strlen($candidate) > 120) {
                $candidate = rtrim(mb_substr($candidate, 0, 120)) . '...';
            }

            return $candidate;
        }

        return $title;
    }

    private function mapSeverityFromAiImpactLevel(?string $impactLevel): string
    {
        return match ($impactLevel) {
            'high' => 'critical',
            'medium' => 'warning',
            'low' => 'notice',
            'none' => 'info',
            default => 'info',
        };
    }

    private function normalizeAiImpactLevel(mixed $value): ?string
    {
        $normalized = strtolower(trim((string) $value));
        return in_array($normalized, ['none', 'low', 'medium', 'high'], true) ? $normalized : null;
    }

    private function normalizeAiUrgency(mixed $value): ?string
    {
        $normalized = strtolower(trim((string) $value));
        return in_array($normalized, ['none', 'observe', 'today', 'fast', 'immediate'], true) ? $normalized : null;
    }

    private function normalizeAiConfidence(mixed $value): ?string
    {
        $normalized = strtolower(trim((string) $value));
        return in_array($normalized, ['low', 'medium', 'high'], true) ? $normalized : null;
    }

    private function normalizeAiStatus(mixed $value): string
    {
        $normalized = strtolower(trim((string) $value));
        if (in_array($normalized, ['pending', 'rated', 'failed'], true)) {
            return $normalized;
        }
        return 'pending';
    }

    private function parseDateQueryToUtc(?string $raw): ?string
    {
        if ($raw === null || trim($raw) === '') {
            return null;
        }

        try {
            return (new \DateTimeImmutable($raw))
                ->setTimezone(new \DateTimeZone('UTC'))
                ->format('Y-m-d H:i:s');
        } catch (Throwable) {
            return null;
        }
    }

    private function resolveBannerDurationHours(): int
    {
        $raw = getenv('CS_UPDATES_BANNER_DURATION_HOURS');
        if ($raw === false) {
            return self::DEFAULT_BANNER_DURATION_HOURS;
        }

        $hours = (int) $raw;
        if ($hours < self::MIN_BANNER_DURATION_HOURS) {
            return self::MIN_BANNER_DURATION_HOURS;
        }
        if ($hours > self::MAX_BANNER_DURATION_HOURS) {
            return self::MAX_BANNER_DURATION_HOURS;
        }

        return $hours;
    }
}
