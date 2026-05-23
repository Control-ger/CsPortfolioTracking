<?php
declare(strict_types=1);

namespace App\Infrastructure\External;

use RuntimeException;

final class SteamDbPatchnotesClient
{
    public function __construct(
        private readonly int $timeoutSeconds = 12
    ) {
    }

    public function fetchSummaryText(string $url, int $maxLength = 2200): string
    {
        $target = trim($url);
        if ($target === '') {
            return '';
        }

        $html = $this->fetchHtml($target);
        if ($this->isCloudflareChallenge($html)) {
            throw new RuntimeException('SteamDB patchnotes page is protected by a challenge.');
        }

        $candidates = [];
        $jsonLd = $this->extractJsonLdText($html);
        if ($jsonLd !== '') {
            $candidates[] = $jsonLd;
        }

        $metaDescription = $this->extractMetaDescription($html);
        if ($metaDescription !== '') {
            $candidates[] = $metaDescription;
        }

        $mainContent = $this->extractMainContentText($html);
        if ($mainContent !== '') {
            $candidates[] = $mainContent;
        }

        $best = $this->pickBestCandidate($candidates);
        if ($best === '') {
            return '';
        }

        return $this->truncate($best, max(200, $maxLength));
    }

    private function fetchHtml(string $url): string
    {
        $ch = curl_init($url);
        if ($ch === false) {
            throw new RuntimeException('Failed to initialize cURL for patchnotes enrichment.');
        }

        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => max(3, $this->timeoutSeconds),
            CURLOPT_HTTPHEADER => [
                'Accept: text/html,application/xhtml+xml',
                'Accept-Language: en-US,en;q=0.9',
                'User-Agent: CSInvestorHub/1.0 (+https://github.com/Control-ger/CsPortfolioTracking)',
            ],
        ]);

        $raw = curl_exec($ch);
        $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        if (!is_string($raw) || trim($raw) === '') {
            throw new RuntimeException('Patchnotes page returned an empty response.');
        }

        if ($httpCode < 200 || $httpCode >= 300) {
            throw new RuntimeException('Patchnotes page returned HTTP ' . $httpCode . ($error !== '' ? ' (' . $error . ')' : ''));
        }

        return $raw;
    }

    private function isCloudflareChallenge(string $html): bool
    {
        $needle = strtolower($html);
        return str_contains($needle, 'enable javascript and cookies to continue')
            || str_contains($needle, '__cf_chl_opt')
            || str_contains($needle, 'cf-error');
    }

    private function extractJsonLdText(string $html): string
    {
        if (preg_match_all('/<script[^>]*type=["\']application\/ld\+json["\'][^>]*>(.*?)<\/script>/is', $html, $matches) !== 1) {
            return '';
        }

        $chunks = [];
        foreach ($matches[1] as $rawJson) {
            $decoded = json_decode(html_entity_decode((string) $rawJson, ENT_QUOTES | ENT_HTML5, 'UTF-8'), true);
            if (!is_array($decoded)) {
                continue;
            }

            $flattened = $this->extractJsonLdStrings($decoded);
            if ($flattened !== '') {
                $chunks[] = $flattened;
            }
        }

        return $this->normalizeWhitespace(implode(' ', $chunks));
    }

    /**
     * @param array<string,mixed>|array<int,mixed> $node
     */
    private function extractJsonLdStrings(array $node): string
    {
        $targets = ['articleBody', 'description', 'headline', 'name', 'text'];
        $parts = [];

        foreach ($targets as $key) {
            $value = $node[$key] ?? null;
            if (is_string($value) && trim($value) !== '') {
                $parts[] = $value;
            }
        }

        foreach ($node as $value) {
            if (is_array($value)) {
                $nested = $this->extractJsonLdStrings($value);
                if ($nested !== '') {
                    $parts[] = $nested;
                }
            }
        }

        return $this->normalizeWhitespace(implode(' ', $parts));
    }

    private function extractMetaDescription(string $html): string
    {
        if (preg_match('/<meta[^>]+property=["\']og:description["\'][^>]+content=["\'](.*?)["\'][^>]*>/is', $html, $matches) === 1) {
            return $this->normalizeWhitespace(html_entity_decode((string) $matches[1], ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        }

        if (preg_match('/<meta[^>]+name=["\']description["\'][^>]+content=["\'](.*?)["\'][^>]*>/is', $html, $matches) === 1) {
            return $this->normalizeWhitespace(html_entity_decode((string) $matches[1], ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        }

        return '';
    }

    private function extractMainContentText(string $html): string
    {
        $working = $html;
        $working = preg_replace('/<script\b[^>]*>.*?<\/script>/is', ' ', $working) ?? $working;
        $working = preg_replace('/<style\b[^>]*>.*?<\/style>/is', ' ', $working) ?? $working;
        $working = preg_replace('/<noscript\b[^>]*>.*?<\/noscript>/is', ' ', $working) ?? $working;

        if (preg_match('/<(main|article)\b[^>]*>(.*?)<\/\1>/is', $working, $matches) === 1) {
            $working = (string) $matches[2];
        }

        return $this->normalizeWhitespace(html_entity_decode(strip_tags($working), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
    }

    /**
     * @param array<int,string> $candidates
     */
    private function pickBestCandidate(array $candidates): string
    {
        $best = '';
        $bestScore = 0;

        foreach ($candidates as $candidate) {
            $clean = $this->normalizeWhitespace((string) $candidate);
            if ($clean === '') {
                continue;
            }
            if ($this->isLowSignalText($clean)) {
                continue;
            }

            $lengthScore = min(strlen($clean), 2400);
            $keywordScore = preg_match('/\b(update|sticker|souvenir|capsule|trade|case|major|market|fix|map)\b/i', $clean) === 1 ? 200 : 0;
            $score = $lengthScore + $keywordScore;

            if ($score > $bestScore) {
                $best = $clean;
                $bestScore = $score;
            }
        }

        return $best;
    }

    private function isLowSignalText(string $text): bool
    {
        $normalized = strtolower($text);
        if ($normalized === '') {
            return true;
        }
        if (str_contains($normalized, 'steamdb builds for counter-strike 2')) {
            return true;
        }
        if (str_contains($normalized, 'enable javascript and cookies to continue')) {
            return true;
        }
        return strlen($normalized) < 48;
    }

    private function truncate(string $text, int $maxLength): string
    {
        if (mb_strlen($text) <= $maxLength) {
            return $text;
        }
        return rtrim(mb_substr($text, 0, $maxLength)) . '...';
    }

    private function normalizeWhitespace(string $text): string
    {
        return trim(preg_replace('/\s+/', ' ', $text) ?? '');
    }
}

