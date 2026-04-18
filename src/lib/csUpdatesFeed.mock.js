const SIX_HOURS_IN_SECONDS = 6 * 60 * 60;

function hoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

const MOCK_ITEMS = [
  {
    id: "cs2-patch-notes-2026-04-17",
    title: "CS2 Patch Notes: Waffen-Balancing und UI-Feinschliff",
    summary: "Ein frisches Update bringt neue Balance-Anpassungen, kleinere UX-Verbesserungen und mehrere Fixes.",
    details:
      "Valve hat ein Update fuer Counter-Strike 2 ausgerollt, das vor allem Gameplay-Balance und kleinere Komfort-Verbesserungen betrifft. Besonders die Waffen-Parameter und UI-Randfaelle wurden ueberarbeitet.",
    highlights: [
      "Waffen-Balancing mit kleinen Preis-/Verfuegbarkeitsfolgen fuer den Markt",
      "UI-Verbesserungen im Inventar und beim Matchmaking-Flow",
      "Mehrere Bugfixes fuer Sound, Animation und Netzwerkverhalten",
    ],
    publishedAt: hoursAgo(3),
    updatedAt: hoursAgo(2.5),
    source: "valve",
    sourceLabel: "Valve",
    url: "https://www.counter-strike.net/news/",
    tags: ["Patch", "Balance", "UI"],
    severity: "notice",
    pinned: true,
    isBreaking: false,
  },
  {
    id: "steam-market-maintenance-2026-04-16",
    title: "Steam Market: Kurzes Wartungsfenster beendet",
    summary: "Die Steam-Market-Infrastruktur war kurzzeitig eingeschraenkt und sollte wieder stabil laufen.",
    details:
      "Ein kurzes Wartungsfenster hat den Zugriff auf den Steam Market zwischendurch beeinflusst. Solche Meldungen sind relevant, weil sie Item-Preise und Datenaktualisierungen kurzfristig beeinflussen koennen.",
    highlights: [
      "Voruebergehende API- und Marktzugriffs-Einschraenkungen",
      "Moegliche Effekte auf kurzfristige Preis-Snapshots",
      "Falls Datenquelle fallbackt, kann ein kurzer Preisversatz sichtbar sein",
    ],
    publishedAt: hoursAgo(18),
    updatedAt: hoursAgo(17.5),
    source: "steam***REMOVED***",
    sourceLabel: "SteamDB",
    url: "https://steam***REMOVED***.info/",
    tags: ["Steam", "Market", "Maintenance"],
    severity: "info",
    pinned: false,
    isBreaking: false,
  },
  {
    id: "major-rotation-2026-04-14",
    title: "Map Pool Update: Rotation im kompetitiven Bereich",
    summary: "Die aktuelle Map-Auswahl wurde angepasst und kann Matchmaking- und Handels-Interesse verschieben.",
    details:
      "Eine neue Rotation oder eine Anpassung an der Map-Auswahl wirkt sich oft indirekt auf das Spielerinteresse und damit auf bestimmte Skin-Kategorien aus. Der direkte Effekt ist selten sofort, kann aber ueber Stunden und Tage sichtbar werden.",
    highlights: [
      "Weniger Fokus auf einzelne Maps kann Preise bestimmter Collections bewegen",
      "Community-Reaktion oft verzoegert sichtbar",
      "Interessant fuer Tren***REMOVED***eobachtung in Watchlist und Portfolio",
    ],
    publishedAt: hoursAgo(42),
    updatedAt: hoursAgo(42),
    source: "community",
    sourceLabel: "Community",
    url: "https://www.counter-strike.net/news/",
    tags: ["Maps", "Meta", "Community"],
    severity: "info",
    pinned: false,
    isBreaking: false,
  },
  {
    id: "anti-cheat-backend-2026-04-12",
    title: "Anti-Cheat Backend: Zusätzliche Schutzmassnahmen aktiv",
    summary: "Neue backendseitige Schutzmechanismen wurden aktiviert und koennten indirekt Match- und Trust-Signale beeinflussen.",
    details:
      "Sicherheitsrelevante Backend-Aenderungen werden meist nicht breit ausgespielt, koennen aber fuer Trading- und Community-Interesse wichtig sein, wenn Spieler auf Stabilitaet und Account-Sicherheit achten.",
    highlights: [
      "Staerkere Schutzmechanismen im Hintergrund",
      "Keine direkte UI-Auswirkung, aber wichtige Kontext-Info",
      "Relevanz fuer Live-Feed und externe Quellenaggregation",
    ],
    publishedAt: hoursAgo(96),
    updatedAt: hoursAgo(96),
    source: "valve",
    sourceLabel: "Valve",
    url: "https://www.counter-strike.net/news/",
    tags: ["Security", "Anti-Cheat", "Backend"],
    severity: "warning",
    pinned: false,
    isBreaking: true,
  },
  {
    id: "armory-economy-2026-04-10",
    title: "Armory-Ökonomie: Weiterhin schwankende Nachfrage",
    summary: "Einige Gegenstaende im Markt zeigen weiterhin volatile Preisbewegungen durch Nachfrage und Angebot.",
    details:
      "Die Marktmechanik bei gesuchten Items bleibt volatil. Gerade wenn neue Patches oder Community-Reaktionen eintreffen, kann die Nachfrage kurzzeitig stark schwanken.",
    highlights: [
      "Preisbewegungen oft nicht rein patch-getrieben",
      "Externe Datenquellen sind fuer Kontext wertvoll",
      "Gut geeignet fuer Feed-Hervorhebung und Trend-Interpretation",
    ],
    publishedAt: hoursAgo(150),
    updatedAt: hoursAgo(150),
    source: "steam***REMOVED***",
    sourceLabel: "SteamDB",
    url: "https://steam***REMOVED***.info/",
    tags: ["Economy", "Market", "Items"],
    severity: "info",
    pinned: false,
    isBreaking: false,
  },
];

export function getMockCsUpdatesFeed() {
  const now = new Date();

  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
    data: MOCK_ITEMS.map((item) => ({ ...item })),
    meta: {
      sourceMode: "mock",
      fetchedAt: now.toISOString(),
      lastRefreshAt: now.toISOString(),
      staleAfterSeconds: SIX_HOURS_IN_SECONDS,
      isStale: false,
    },
      });
    }, 180);
  });
}

export { MOCK_ITEMS as CS_UPDATES_FEED_MOCK_ITEMS };



