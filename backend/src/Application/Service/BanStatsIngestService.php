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
    private const CS2_SOURCE   = 'csstats_gg';  // CS2-specific bans — preferred trigger source
    private const STEAM_SOURCE = 'vac_ban_api'; // All Steam games — corroboration source

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
                $this->banStatsRepository->upsert($item['date'], self::STEAM_SOURCE, $item['ban_count'], $fetchedAt);
                $vacBanRows++;
            }
        } catch (Throwable $e) {
            $errors[] = 'vac_ban_api: ' . $e->getMessage();
        }

        try {
            $items = $this->csStatsBansClient->fetch();
            foreach ($items as $item) {
                $this->banStatsRepository->upsert($item['date'], self::CS2_SOURCE, $item['ban_count'], $fetchedAt);
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

        // Prefer CS2-specific source; fall back to all-Steam only when CS2 lacks sufficient history.
        $cs2Rows = $this->banStatsRepository->getRecentCompletedBySource(
            self::CS2_SOURCE,
            $todayUtc,
            $this->rollingWindowDays + 1
        );
        $activeSource = self::CS2_SOURCE;
        $rows = $cs2Rows;

        if (count($cs2Rows) <= $this->minHistoryDays) {
            $steamRows = $this->banStatsRepository->getRecentCompletedBySource(
                self::STEAM_SOURCE,
                $todayUtc,
                $this->rollingWindowDays + 1
            );
            if (count($steamRows) > count($cs2Rows)) {
                $activeSource = self::STEAM_SOURCE;
                $rows = $steamRows;
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

        $ratioFormatted = number_format($ratio * 100, 0, ',', '.') . '%';
        $countFormatted = number_format($todayCount, 0, ',', '.');
        $baselineFormatted = number_format((int) round($baseline), 0, ',', '.');
        $thresholdFormatted = number_format($this->waveThreshold * 100, 0, ',', '.') . '%';

        $corroborationSource = $activeSource === self::CS2_SOURCE ? self::STEAM_SOURCE : self::CS2_SOURCE;
        $corroborationContext = $this->buildCorroborationContext(
            $latestRow['stat_date'],
            $todayUtc,
            $corroborationSource
        );

        $title = 'VAC Ban-Welle erkannt: ' . $countFormatted . ' Bans am ' . $latestRow['stat_date'];
        $summary = sprintf(
            'Am %s wurden %s VAC-Bans verzeichnet (%s des Medians der letzten %d Tage: %s Bans). '
            . 'Ban-Wellen koennen kurzfristigen Markt-Impact haben: erhoehte Trading-Aktivitaet und '
            . 'Preisbewegungen bei Skins und Kisten sind typisch. '
            . 'Quelle: %s. Schwellenwert: %s / mind. %d Bans. %s',
            $latestRow['stat_date'],
            $countFormatted,
            $ratioFormatted,
            count($historyRows),
            $baselineFormatted,
            $activeSource,
            $thresholdFormatted,
            $this->minAbsoluteCount,
            $corroborationContext
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

    private function buildCorroborationContext(string $targetDate, string $todayUtc, string $otherSource): string
    {
        $otherRows = $this->banStatsRepository->getRecentCompletedBySource(
            $otherSource,
            $todayUtc,
            $this->rollingWindowDays + 1
        );

        // Look for the same date in the other source
        $otherLatest = null;
        foreach ($otherRows as $row) {
            if ($row['stat_date'] === $targetDate) {
                $otherLatest = $row;
                break;
            }
        }

        if ($otherLatest === null) {
            return $otherSource === self::STEAM_SOURCE
                ? 'Alle-Steam-Korroboration (vac-ban.com) nicht verfuegbar.'
                : 'CS2-spezifische Quelle (csstats.gg) nicht verfuegbar — Welle basiert auf Alle-Steam-Daten (weniger praezise fuer CS2).';
        }

        $otherHistory = array_values(array_filter(
            $otherRows,
            static fn(array $r) => $r['stat_date'] !== $targetDate
        ));

        if (count($otherHistory) < $this->minHistoryDays) {
            $label = $otherSource === self::STEAM_SOURCE ? 'vac-ban.com' : 'csstats.gg';
            return $label . ': zu wenig Historie fuer Korroboration.';
        }

        $otherCounts = array_column($otherHistory, 'ban_count');
        sort($otherCounts);
        $m = count($otherCounts);
        $otherBaseline = $m % 2 === 1
            ? (float) $otherCounts[($m - 1) / 2]
            : ((float) $otherCounts[$m / 2 - 1] + (float) $otherCounts[$m / 2]) / 2.0;

        if ($otherBaseline <= 0.0) {
            return 'Korroboration: Baseline der zweiten Quelle nicht berechenbar.';
        }

        $otherCount = (int) $otherLatest['ban_count'];
        $otherRatio = $otherCount / $otherBaseline;
        $sourceLabel = $otherSource === self::STEAM_SOURCE
            ? 'vac-ban.com (alle Steam-Spiele)'
            : 'csstats.gg (CS2-spezifisch)';
        $otherRatioFmt = number_format($otherRatio * 100, 0, ',', '.') . '%';
        $otherCountFmt = number_format($otherCount, 0, ',', '.');

        if ($otherRatio >= $this->waveThreshold) {
            return sprintf('Korroboriert durch %s: %s Bans (%s des Medians).', $sourceLabel, $otherCountFmt, $otherRatioFmt);
        }

        if ($otherRatio > 1.0) {
            return sprintf('%s zeigt erhoehte Aktivitaet (%s des Medians), aber unter Schwellenwert.', $sourceLabel, $otherRatioFmt);
        }

        return sprintf('%s zeigt keinen Spike (%s des Medians) — Einzelquellen-Signal.', $sourceLabel, $otherRatioFmt);
    }
}
