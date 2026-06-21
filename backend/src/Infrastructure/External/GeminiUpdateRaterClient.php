<?php
declare(strict_types=1);

namespace App\Infrastructure\External;

use RuntimeException;

final class GeminiUpdateRaterClient
{
    public function __construct(
        private readonly string $apiKey,
        private readonly string $model = 'gemini-2.5-flash',
        private readonly int $timeoutMs = 20000
    ) {
    }

    public static function fromEnv(): ?self
    {
        $apiKey = trim((string) (getenv('GEMINI_API_KEY') ?: ''));
        $enabled = in_array(
            strtolower(trim((string) (getenv('CS_UPDATES_AI_ENABLED') ?: '0'))),
            ['1', 'true', 'yes', 'on'],
            true
        );

        if (!$enabled || $apiKey === '') {
            return null;
        }

        $model = trim((string) (getenv('CS_UPDATES_AI_MODEL') ?: 'gemini-2.5-flash'));
        if ($model === '') {
            $model = 'gemini-2.5-flash';
        }

        $timeoutMs = (int) (getenv('CS_UPDATES_AI_TIMEOUT_MS') ?: 20000);
        if ($timeoutMs < 3000) {
            $timeoutMs = 3000;
        }

        return new self($apiKey, $model, $timeoutMs);
    }

    public function modelName(): string
    {
        return $this->model;
    }

    /**
     * @param array<string,mixed> $updateRow
     * @return array<string,mixed>
     */
    public function classify(array $updateRow): array
    {
        $title = trim((string) ($updateRow['title'] ?? ''));
        $summary = trim((string) ($updateRow['summary_raw'] ?? ''));
        $source = trim((string) ($updateRow['source'] ?? ''));
        $publishedAt = trim((string) ($updateRow['published_at'] ?? ''));

        $prompt = implode("\n", [
            'Du bewertest Counter-Strike 2 Update-Meldungen fuer Trading-Entscheidungen (Skins, Sticker, Cases).',
            'Bewerte nur Markt-Impact und Handlungsdringlichkeit.',
            '',
            'Antworte NUR als gueltiges JSON Objekt ohne Markdown.',
            'Erlaubte Felder:',
            '- impact_level: one of ["none","low","medium","high"]',
            '- impact_score: integer 0..100',
            '- urgency: one of ["none","observe","today","fast","immediate"]',
            '- recommended_action: konkrete Aktion (buy/hold/sell + Zielsegment, max 120 Zeichen)',
            '- confidence: one of ["low","medium","high"]',
            '- reasoning: kurze Begruendung (max 280 Zeichen)',
            '',
            'Regelhinweise:',
            '- Reine Bugfixes/UI/Audio meist none/low.',
            '- Ban waves (source=ban_wave_detected): haeufig medium oder high Impact.',
            '  * Grosse Ban-Wellen (>2.5x Median) -> impact_level=medium, impact_score 55-70.',
            '  * Sehr grosse Ban-Wellen (>4x Median) -> impact_level=high, impact_score 75-90.',
            '  * Ban-Wellen gehen Marktbewegungen oft voraus oder folgen ihnen (1-3 Tage Verzoegerung).',
            '  * Erhoehte Nachfrage nach Cases und guenstigen Skins typisch nach Ban-Wellen.',
            '  * Empfehlung: "WATCH Cases und Entry-Level Skins" oder "BUY guenstige Cases staffeln".',
            '  * urgency=observe fuer moderate Wellen, urgency=today fuer sehr grosse Wellen (>4x).',
            '  * Wenn summary "Korroboriert durch" enthaelt -> confidence=high, score nahe Obergrenze des Bereichs.',
            '  * Wenn summary "Einzelquellen-Signal" oder "nicht verfuegbar" -> confidence=medium.',
            '  * Wenn summary "basiert auf Alle-Steam-Daten" -> confidence=low; CS2-Impact schwerer abzuschaetzen.',
            '- Trade-up, Sticker-Entfernung, neue Sticker/Cases/Capsules/Collections meist medium/high.',
            '- Wenn moeglich: nenne Segment im recommended_action (z.B. Souvenir, Sticker Capsule, High-Tier Skins).',
            '- Formuliere handlungsorientiert, z.B. "SELL High-Tier Skins heute", "BUY alte Major Capsules staffeln".',
            '- Bei Unsicherheit konservativ bleiben.',
            '',
            'INPUT:',
            'title: ' . $title,
            'summary: ' . $summary,
            'source: ' . $source,
            'published_at_utc: ' . $publishedAt,
        ]);

        $url = sprintf(
            'https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s',
            rawurlencode($this->model),
            rawurlencode($this->apiKey)
        );

        $payload = [
            'contents' => [
                [
                    'parts' => [
                        ['text' => $prompt],
                    ],
                ],
            ],
            'generationConfig' => [
                'response_mime_type' => 'application/json',
                'temperature' => 0.2,
                'top_p' => 0.8,
                'max_output_tokens' => 400,
            ],
        ];

        $response = $this->postJson($url, $payload);
        $candidateText = $this->extractCandidateText($response);
        $decoded = $this->decodeJsonObject($candidateText);

        $impactLevel = $this->normalizeImpactLevel($decoded['impact_level'] ?? null);
        $urgency = $this->normalizeUrgency($decoded['urgency'] ?? null);
        $confidence = $this->normalizeConfidence($decoded['confidence'] ?? null);
        $impactScore = $this->normalizeImpactScore($decoded['impact_score'] ?? null, $impactLevel);
        $recommendedAction = $this->normalizeShortText($decoded['recommended_action'] ?? '', 120);
        $reasoning = $this->normalizeShortText($decoded['reasoning'] ?? '', 280);

        if ($recommendedAction === '') {
            $recommendedAction = $this->defaultActionForUrgency($urgency);
        }
        if ($reasoning === '') {
            $reasoning = 'Automatische Bewertung ohne weitere Begruendung.';
        }

        return [
            'impact_level' => $impactLevel,
            'impact_score' => $impactScore,
            'urgency' => $urgency,
            'recommended_action' => $recommendedAction,
            'confidence' => $confidence,
            'reasoning' => $reasoning,
            'model' => $this->model,
        ];
    }

    /**
     * @param array<string,mixed> $payload
     * @return array<string,mixed>
     */
    private function postJson(string $url, array $payload): array
    {
        $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if (!is_string($json)) {
            throw new RuntimeException('Failed to encode Gemini payload as JSON.');
        }

        $ch = curl_init($url);
        if ($ch === false) {
            throw new RuntimeException('Failed to initialize cURL.');
        }

        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT_MS => $this->timeoutMs,
            CURLOPT_CONNECTTIMEOUT_MS => 5000,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
            ],
            CURLOPT_POSTFIELDS => $json,
        ]);

        $body = curl_exec($ch);
        $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);

        if (!is_string($body) || $body === '') {
            throw new RuntimeException('Gemini API returned an empty response.');
        }

        if ($httpCode < 200 || $httpCode >= 300) {
            throw new RuntimeException('Gemini API request failed with HTTP ' . $httpCode . ': ' . $body);
        }

        if ($curlError !== '') {
            throw new RuntimeException('Gemini API cURL error: ' . $curlError);
        }

        $decoded = json_decode($body, true);
        if (!is_array($decoded)) {
            throw new RuntimeException('Gemini API returned invalid JSON.');
        }

        return $decoded;
    }

    /**
     * @param array<string,mixed> $response
     */
    private function extractCandidateText(array $response): string
    {
        $candidates = $response['candidates'] ?? null;
        if (!is_array($candidates) || !isset($candidates[0]) || !is_array($candidates[0])) {
            throw new RuntimeException('Gemini API response has no candidates.');
        }

        $parts = $candidates[0]['content']['parts'] ?? null;
        if (!is_array($parts)) {
            throw new RuntimeException('Gemini API candidate has no parts.');
        }

        $textChunks = [];
        foreach ($parts as $part) {
            if (is_array($part) && isset($part['text']) && is_string($part['text'])) {
                $textChunks[] = $part['text'];
            }
        }

        $text = trim(implode("\n", $textChunks));
        if ($text === '') {
            throw new RuntimeException('Gemini API candidate text is empty.');
        }

        return $text;
    }

    /**
     * @return array<string,mixed>
     */
    private function decodeJsonObject(string $text): array
    {
        $try = trim($text);
        $decoded = json_decode($try, true);
        if (is_array($decoded)) {
            return $decoded;
        }

        $withoutFences = preg_replace('/^```(?:json)?\s*|\s*```$/i', '', $try) ?? $try;
        $decoded = json_decode(trim($withoutFences), true);
        if (is_array($decoded)) {
            return $decoded;
        }

        if (preg_match('/\{.*\}/s', $withoutFences, $matches) === 1) {
            $decoded = json_decode($matches[0], true);
            if (is_array($decoded)) {
                return $decoded;
            }
        }

        throw new RuntimeException('Gemini JSON parsing failed: ' . $text);
    }

    private function normalizeImpactLevel(mixed $value): string
    {
        $normalized = strtolower(trim((string) $value));
        return in_array($normalized, ['none', 'low', 'medium', 'high'], true) ? $normalized : 'low';
    }

    private function normalizeUrgency(mixed $value): string
    {
        $normalized = strtolower(trim((string) $value));
        return in_array($normalized, ['none', 'observe', 'today', 'fast', 'immediate'], true) ? $normalized : 'observe';
    }

    private function normalizeConfidence(mixed $value): string
    {
        $normalized = strtolower(trim((string) $value));
        return in_array($normalized, ['low', 'medium', 'high'], true) ? $normalized : 'medium';
    }

    private function normalizeImpactScore(mixed $value, string $impactLevel): int
    {
        $numeric = is_numeric($value) ? (int) $value : -1;
        if ($numeric >= 0 && $numeric <= 100) {
            return $numeric;
        }

        return match ($impactLevel) {
            'none' => 5,
            'low' => 25,
            'medium' => 60,
            'high' => 90,
            default => 30,
        };
    }

    private function normalizeShortText(mixed $value, int $maxLength): string
    {
        $text = trim((string) $value);
        if ($text === '') {
            return '';
        }
        if (mb_strlen($text) <= $maxLength) {
            return $text;
        }
        return rtrim(mb_substr($text, 0, $maxLength - 3)) . '...';
    }

    private function defaultActionForUrgency(string $urgency): string
    {
        return match ($urgency) {
            'immediate' => 'Sofort Watchlist und Preise pruefen.',
            'fast' => 'Zeitnah Watchlist und Preise pruefen.',
            'today' => 'Heute Marktbewegung beobachten.',
            'observe' => 'Normales Monitoring ausreichend.',
            'none' => 'Kein akuter Handlungsbedarf.',
            default => 'Normales Monitoring ausreichend.',
        };
    }
}
