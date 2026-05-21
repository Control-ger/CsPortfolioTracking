<?php
declare(strict_types=1);

namespace App\Infrastructure\External;

use RuntimeException;

final class SteamDbRssClient
{
    public function __construct(
        private readonly ?string $rssUrl = null,
        private readonly int $timeoutSeconds = 10
    ) {
    }

    public function resolveRssUrl(): string
    {
        $configured = trim((string) ($this->rssUrl ?? getenv('CS_UPDATES_RSS_URL') ?: ''));
        if ($configured !== '') {
            return $configured;
        }

        return 'https://steamdb.info/api/PatchnotesRSS/?appid=730';
    }

    public function fetchRawXml(): string
    {
        $url = $this->resolveRssUrl();
        $context = stream_context_create([
            'http' => [
                'method' => 'GET',
                'timeout' => max(1, $this->timeoutSeconds),
                'header' => "User-Agent: CSInvestorHub/1.0 (+https://github.com/Control-ger/CsPortfolioTracking)\r\n",
            ],
            'ssl' => [
                'verify_peer' => true,
                'verify_peer_name' => true,
            ],
        ]);

        $raw = @file_get_contents($url, false, $context);
        if ($raw === false || trim($raw) === '') {
            throw new RuntimeException('Unable to fetch SteamDB RSS feed from ' . $url);
        }

        return (string) $raw;
    }

    /**
     * @return array<int,array<string,string>>
     */
    public function fetchItems(): array
    {
        $xmlRaw = $this->fetchRawXml();
        $xml = @simplexml_load_string($xmlRaw, \SimpleXMLElement::class, LIBXML_NOCDATA);
        if (!$xml instanceof \SimpleXMLElement) {
            throw new RuntimeException('SteamDB RSS response is not valid XML.');
        }

        $channelItems = $xml->channel->item ?? null;
        if (!($channelItems instanceof \SimpleXMLElement)) {
            return [];
        }

        $items = [];
        foreach ($channelItems as $entry) {
            if (!$entry instanceof \SimpleXMLElement) {
                continue;
            }

            $items[] = [
                'guid' => trim((string) ($entry->guid ?? '')),
                'title' => trim((string) ($entry->title ?? '')),
                'link' => trim((string) ($entry->link ?? '')),
                'description' => trim((string) ($entry->description ?? '')),
                'pubDate' => trim((string) ($entry->pubDate ?? '')),
            ];
        }

        return $items;
    }
}
