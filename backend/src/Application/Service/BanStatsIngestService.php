<?php
declare(strict_types=1);

namespace App\Application\Service;

use App\Infrastructure\External\CsStatsBansClient;
use App\Infrastructure\External\VacBanApiClient;
use App\Infrastructure\Persistence\Repository\BanStatsRepository;
use App\Infrastructure\Persistence\Repository\CsUpdatesFeedRepository;
use Throwable;

final class BanStatsIngestService
{
    private const PRIMARY_SOURCE = 'vac_ban_api';
    private const FALLBACK_SOURCE = 'csstats_gg';

    public function __construct(
        private readonly VacBanApiClient $vacBanApiClient,
        private readonly CsStatsBansClient $csStatsBansClient,
        private readonly BanStatsRepository $banStatsRepository,
        private readonly CsUpdatesFeedRepository $feedRepository,
        private readonly float $waveThreshold = 2.5,
        private readonly int $minHistoryDays = 7,
        private readonly int $rollingWindowDays = 14,
        private readonly int $minAbsoluteCount = 200,
    ) {
    }

    /**
     * @return array{vacBanRows:int,csstatsRows:int,waveDetected:bool,waveFeedInserted:bool,errors:string[]}
     */
    public function ingest(): array
    {
        $fetchedAt = gmdate('Y-m-d H:i:s');
        $errors = [];
        $vacBanRows = 0;
        $csstatsRows = 0;

        try {
            $items = $this->vacBanApiClient->fetch();
            foreach ($items as $item) {
                $this->banStatsRepository->upsert($item['date'], self::PRIMARY_SOURCE, $item['ban_count'], $fetchedAt);
                $vacBanRows++;
            }
        } catch (Throwable $e) {
            $errors[] = 'vac_ban_api: ' . $e->getMessage();
        }

        try {
            $items = $this->csStatsBansClient->fetch();
            foreach ($items as $item) {
                $this->banStatsRepository->upsert($item['date'], self::FALLBACK_SOURCE, $item['ban_count'], $fetchedAt);
                $csstatsRows++;
            }
        } catch (Throwable $e) {
            $errors[] = 'csstats_gg: ' . $e->getMessage();
        }

        [$waveDetected, $waveFeedInserted] = $this->detectAndInjectWave();

        return [
            'vacBanRows' => $vacBanRows,
            'csstatsRows' => $csstatsRows,
            'waveDetected' => $waveDetected,
            'waveFeedInserted' => $waveFeedInserted,
            'errors' => $errors,
        ];
    }

    /**
     * @return array{bool,bool}
     */
    private function detectAndInjectWave(): array
    {
        // Exclude the current day (UTC) — partial-day counts would skew detection
        // and any injected entry would be frozen with wrong numbers by the idempotency lock.
        $todayUtc = gmdate('Y-m-d');

        // Pick the source with the most completed rows, preferring primary when tied.
        // Fall back only when primary has insufficient history, not just when it has zero rows.
        $primaryRows = $this->banStatsRepository->getRecentCompletedBySource(
            self::PRIMARY_SOURCE,
            $todayUtc,
            $this->rollingWindowDays + 1
        );
        $activeSource = self::PRIMARY_SOURCE;
        $rows = $primaryRows;

        if (count($primaryRows) <= $this->minHistoryDays) {
            $fallbackRows = $this->banStatsRepository->getRecentCompletedBySource(
                self::FALLBACK_SOURCE,
                $todayUtc,
                $this->rollingWindowDays + 1
            );
            if (count($fallbackRows) > count($primaryRows)) {
                $activeSource = self::FALLBACK_SOURCE;
                $rows = $fallbackRows;
            }
        }

        if (count($rows) < 1) {
            return [false, false];
        }

        $latestRow = $rows[0];
        $historyRows = array_slice($rows, 1);

        if (count($historyRows) < $this->minHistoryDays) {
            return [false, false];
        }

        // Median baseline — more robust than mean against previous wave events in the window
        $counts = array_column($historyRows, 'ban_count');
        sort($counts);
        $n = count($counts);
        $baseline = $n % 2 === 1
            ? (float) $counts[($n - 1) / 2]
            : ((float) $counts[$n / 2 - 1] + (float) $counts[$n / 2]) / 2.0;

        if ($baseline <= 0.0) {
            return [false, false];
        }

        $todayCount = (int) $latestRow['ban_count'];
        $ratio = $todayCount / $baseline;

        // Both conditions required: relative spike AND absolute floor to avoid false positives on low-noise days
        if ($ratio < $this->waveThreshold || $todayCount < $this->minAbsoluteCount) {
            return [false, false];
        }

        // Wave detected — check idempotency before injecting feed entry
        $externalId = 'banwave_' . $latestRow['stat_date'];
        $this->feedRepository->ensureTable();
        $existing = $this->feedRepository->findByExternalId($externalId);
        if ($existing !== null) {
            // Already in feed — do not re-upsert (would reset ai_rating_status to pending)
            return [true, false];
        }

        $ratioFormatted = number_format($ratio, 1, ',', '.');
        $countFormatted = number_format($todayCount, 0, ',', '.');
        $baselineFormatted = number_format((int) round($baseline), 0, ',', '.');
        $thresholdFormatted = number_format($this->waveThreshold, 1, ',', '.');

        $title = 'VAC Ban-Welle erkannt: ' . $countFormatted . ' Bans am ' . $latestRow['stat_date'];
        $summary = sprintf(
            'Am %s wurden %s VAC-Bans verzeichnet (%sx ueber dem Median der letzten %d Tage: %s Bans). '
            . 'Ban-Wellen koennen kurzfristigen Markt-Impact haben: erhoehte Trading-Aktivitaet und '
            . 'Preisbewegungen bei Skins und Kisten sind typisch. '
            . 'Quelle: %s. Schwellenwert: %sx / mind. %d Bans.',
            $latestRow['stat_date'],
            $countFormatted,
            $ratioFormatted,
            count($historyRows),
            $baselineFormatted,
            $activeSource,
            $thresholdFormatted,
            $this->minAbsoluteCount
        );

        $this->feedRepository->upsert([
            'source' => 'ban_wave_detected',
            'external_id' => $externalId,
            'title' => $title,
            'url' => '',
            'summary_raw' => $summary,
            'published_at' => $latestRow['stat_date'] . ' 00:00:00',
            'changelist_id' => null,
            'build_id' => null,
            'branch' => null,
        ]);

        return [true, true];
    }
}
