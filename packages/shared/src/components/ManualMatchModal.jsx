import { useMemo, useState } from "react";
import { Link2, Search, X } from "lucide-react";

// Manual Steam<->CSFloat linking. The scorer only ever proposes pairs it is
// confident about; this is the escape hatch for everything it missed, so both
// lists deliberately show only positions that are NOT already linked.
//
// The right-hand list is ranked against the selected Steam item — picking a side
// first is what makes the "best match" ordering meaningful, which is why the
// score column stays blank until then.

function candidateText(item) {
  return [
    item?.name,
    item?.marketHashName,
    item?.externalTradeId,
    item?.floatValue,
    item?.paintSeed,
  ]
    .filter((value) => value !== null && value !== undefined && value !== "")
    .join(" ")
    .toLowerCase();
}

// Cheap affinity score, deliberately independent of the desktop scorer: it only
// has to rank the visible shortlist, not reproduce the stored match_score.
function affinity(steamItem, csfloatItem) {
  if (!steamItem) {
    return 0;
  }
  const steamName = String(steamItem.marketHashName || steamItem.name || "")
    .trim()
    .toLowerCase();
  const floatName = String(csfloatItem.marketHashName || csfloatItem.name || "")
    .trim()
    .toLowerCase();
  if (!steamName || !floatName) {
    return 0;
  }
  if (steamName === floatName) {
    return 100;
  }
  const steamTokens = new Set(steamName.split(/[\s|()]+/).filter(Boolean));
  const floatTokens = String(floatName)
    .split(/[\s|()]+/)
    .filter(Boolean);
  if (floatTokens.length === 0) {
    return 0;
  }
  const overlap = floatTokens.filter((token) => steamTokens.has(token)).length;
  return Math.round((overlap / floatTokens.length) * 95);
}

function formatMeta(item) {
  const parts = [];
  if (item?.type) parts.push(String(item.type));
  if (Number.isFinite(Number(item?.floatValue)) && Number(item.floatValue) > 0) {
    parts.push(`Float ${Number(item.floatValue).toFixed(4)}`);
  }
  if (item?.paintSeed) parts.push(`Pattern ${item.paintSeed}`);
  const buyPrice = Number(item?.buyPriceUsd ?? item?.buyPrice ?? 0);
  if (buyPrice > 0) parts.push(`${buyPrice.toFixed(2)} USD`);
  if (item?.externalTradeId) parts.push(`#${item.externalTradeId}`);
  return parts.join(" · ") || "Keine Zusatzdaten";
}

function CandidateRow({ item, selected, onSelect, score }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center justify-between gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${
        selected
          ? "border-success/45 bg-success/10"
          : "border-border bg-background hover:border-border-strong"
      }`}
    >
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-bold text-foreground">
          {item.name || item.marketHashName || "Unbenannt"}
        </span>
        <span className="mt-[3px] block truncate text-[11px] text-muted-foreground">
          {formatMeta(item)}
        </span>
      </span>
      <span className="flex flex-none items-center gap-2">
        {Number.isFinite(score) ? (
          <span
            className={`grid h-5 place-items-center rounded-full border px-2 text-[10px] font-extrabold tabular-nums ${
              score >= 90
                ? "border-success/40 bg-success/12 text-success"
                : score >= 60
                  ? "border-warn/40 bg-warn/12 text-warn"
                  : "border-border text-muted-foreground"
            }`}
          >
            {score} %
          </span>
        ) : null}
        <span
          className={`grid size-5 flex-none place-items-center rounded-full text-[11px] font-extrabold ${
            selected ? "bg-success text-background" : "bg-surface-2 text-transparent"
          }`}
        >
          ✓
        </span>
      </span>
    </button>
  );
}

export function ManualMatchModal({
  open,
  onClose,
  steamCandidates = [],
  csfloatCandidates = [],
  onConfirm,
}) {
  const [steamQuery, setSteamQuery] = useState("");
  const [floatQuery, setFloatQuery] = useState("");
  const [selectedSteamId, setSelectedSteamId] = useState(null);
  const [selectedFloatId, setSelectedFloatId] = useState(null);
  const [sortMode, setSortMode] = useState("score");
  const [saving, setSaving] = useState(false);

  const selectedSteam =
    steamCandidates.find((item) => String(item.id) === String(selectedSteamId)) || null;
  const selectedFloat =
    csfloatCandidates.find((item) => String(item.id) === String(selectedFloatId)) || null;

  const steamList = useMemo(() => {
    const query = steamQuery.trim().toLowerCase();
    return steamCandidates.filter((item) => !query || candidateText(item).includes(query));
  }, [steamCandidates, steamQuery]);

  const floatList = useMemo(() => {
    const query = floatQuery.trim().toLowerCase();
    const rows = csfloatCandidates
      .filter((item) => !query || candidateText(item).includes(query))
      .map((item) => ({ item, score: affinity(selectedSteam, item) }));
    if (selectedSteam && sortMode === "score") {
      rows.sort((left, right) => right.score - left.score);
    }
    return rows;
  }, [csfloatCandidates, floatQuery, selectedSteam, sortMode]);

  if (!open) {
    return null;
  }

  const both = Boolean(selectedSteam && selectedFloat);

  const handleConfirm = async () => {
    if (!both || saving) {
      return;
    }
    setSaving(true);
    try {
      await onConfirm({ steamItem: selectedSteam, csfloatItem: selectedFloat });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6 backdrop-blur-[3px]"
      role="dialog"
      aria-modal="true"
      aria-label="Manuelles Matching"
    >
      {/* bg-card, not the design's raw --bg2: that token has no registered
          utility, and an unregistered class renders NO background at all —
          which left the panel fully transparent over the backdrop. */}
      <div className="flex max-h-full w-[900px] max-w-full flex-col overflow-hidden rounded-[18px] border border-border-strong bg-card shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h5 className="text-base font-bold">Manuelles Matching</h5>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Links ein Steam-Item, rechts eine CSFloat-Position wählen, dann verknüpfen.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Schließen"
            className="grid size-[30px] flex-none place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_52px_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-2.5 p-4">
            <div className="flex items-baseline justify-between gap-2.5">
              <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                Steam-Items ohne Zuordnung
              </span>
              <span className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">
                {steamList.length} von {steamCandidates.length} offen
              </span>
            </div>
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-[15px] -translate-y-1/2 text-muted-foreground" />
              <input
                value={steamQuery}
                onChange={(event) => setSteamQuery(event.target.value)}
                placeholder="Item, Float, Pattern, Datum …"
                className="h-9 w-full rounded-[10px] border border-border-strong bg-background pl-8 pr-3 text-[12.5px] outline-none"
              />
            </label>
            <div className="flex max-h-[268px] flex-col gap-2 overflow-y-auto pr-0.5">
              {steamList.length === 0 ? (
                <p className="px-2 py-6 text-center text-[12px] text-muted-foreground">
                  Kein offenes Item passt zur Suche.
                </p>
              ) : (
                steamList.map((item) => (
                  <CandidateRow
                    key={item.id}
                    item={item}
                    selected={String(item.id) === String(selectedSteamId)}
                    onSelect={() => setSelectedSteamId(item.id)}
                  />
                ))
              )}
            </div>
          </div>

          <div className="grid place-items-center border-border-soft bg-surface-1 text-muted-foreground md:border-x">
            <Link2 className="size-[18px]" />
          </div>

          <div className="flex min-w-0 flex-col gap-2.5 p-4">
            <div className="flex items-baseline justify-between gap-2.5">
              <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                CSFloat-Positionen ohne Item
              </span>
              <span className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">
                {floatList.length} von {csfloatCandidates.length} offen
              </span>
            </div>
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-[15px] -translate-y-1/2 text-muted-foreground" />
              <input
                value={floatQuery}
                onChange={(event) => setFloatQuery(event.target.value)}
                placeholder="Position, Preis, CSFloat-ID …"
                className="h-9 w-full rounded-[10px] border border-border-strong bg-background pl-8 pr-3 text-[12.5px] outline-none"
              />
            </label>
            <div className="flex items-center gap-1.5">
              {[
                { value: "score", label: "Bester Treffer" },
                { value: "date", label: "Kaufdatum" },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setSortMode(option.value)}
                  className={`inline-flex h-[26px] items-center rounded-full border px-2.5 text-[11px] font-bold transition-colors ${
                    sortMode === option.value
                      ? "border-transparent bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="flex max-h-[268px] flex-col gap-2 overflow-y-auto pr-0.5">
              {floatList.length === 0 ? (
                <p className="px-2 py-6 text-center text-[12px] text-muted-foreground">
                  Keine offene Position passt zur Suche.
                </p>
              ) : (
                floatList.map(({ item, score }) => (
                  <CandidateRow
                    key={item.id}
                    item={item}
                    selected={String(item.id) === String(selectedFloatId)}
                    onSelect={() => setSelectedFloatId(item.id)}
                    score={selectedSteam ? score : null}
                  />
                ))
              )}
            </div>
            <span className="text-[11px] text-muted-foreground">
              {selectedSteam
                ? "Beste Treffer zum gewählten Item zuerst"
                : "Wähle links ein Item, dann werden Treffer bewertet"}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border bg-surface-1 px-5 py-3">
          <span className={`text-[12px] ${both ? "text-muted-foreground" : "text-warn"}`}>
            {both
              ? "Verknüpfung überschreibt keine bestätigten Matches und ist im Verlauf widerrufbar."
              : "Wähle auf beiden Seiten je einen Eintrag."}
          </span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-[38px] rounded-[10px] border border-border-strong px-3.5 text-[13px] font-semibold transition-colors hover:bg-surface-2"
            >
              Abbrechen
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!both || saving}
              className={`h-[38px] rounded-[10px] px-4.5 text-[13px] font-bold transition-colors ${
                both
                  ? "bg-primary text-primary-foreground"
                  : "cursor-not-allowed bg-surface-2 text-muted-foreground"
              }`}
            >
              {saving ? "Verknüpfe …" : "Verknüpfen"}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

export default ManualMatchModal;
