/**
 * Split a canonical CS market_hash_name into its display parts.
 *
 * The canonical name packs three things into one string —
 * `★ StatTrak™ Karambit | Doppler (Factory New)` — and on a phone the variant
 * prefix and the wear suffix eat the width the actual skin name needs. Pulling
 * them out lets a row render the name plainly and hang the rest off as chips.
 *
 * Two deliberate guards, both because the name is not a reliable grammar:
 *
 * - The `Souvenir` prefix is only a prefix at the *start* of the string.
 *   "Budapest 2025 Train Souvenir Package" is a container whose name merely
 *   contains the word, and stripping it there would rename the item.
 * - The trailing parenthesis is only a wear when it is one of the five real
 *   wears. Stickers and graffiti carry `(Glitter)`, `(Holo)`, `(Foil)` in the
 *   same position, and those are part of the item's identity, not a condition.
 *
 * Anything unparseable falls through with `base` set to the untouched input, so
 * a container like "Fever Case" survives verbatim.
 */

/**
 * Leading segments that name the item's *kind* rather than its weapon, e.g.
 * "Sticker | Boom Blast". Mirrors the prefixes `MarketItemClassifier` keys off.
 *
 * A weapon skin's leading segment ("USP-S | Alpine Camo") is never redundant
 * and is never in this list — dropping it would leave an unidentifiable name.
 */
const KIND_PREFIXES = [
  "Sealed Graffiti",
  "Music Kit",
  "Sticker",
  "Patch",
  "Graffiti",
  "Charm",
  "Collectible",
  "Pin",
];

const WEAR_SHORT = {
  "factory new": "FN",
  "minimal wear": "MW",
  "field-tested": "FT",
  "well-worn": "WW",
  "battle-scarred": "BS",
};

export function parseItemName(rawName) {
  const name = String(rawName ?? "").trim();
  const empty = { base: name, prefixes: [], wear: null, wearShort: null };
  if (!name) {
    return empty;
  }

  let rest = name;
  const prefixes = [];

  if (rest.startsWith("★")) {
    prefixes.push({ key: "star", label: "★", title: "Messer / Handschuhe" });
    rest = rest.slice(1).trim();
  }
  if (/^StatTrak(™|™)?\s/i.test(rest)) {
    prefixes.push({ key: "stattrak", label: "ST", title: "StatTrak™" });
    rest = rest.replace(/^StatTrak(™|™)?\s/i, "").trim();
  } else if (/^Souvenir\s/i.test(rest)) {
    prefixes.push({ key: "souvenir", label: "S", title: "Souvenir" });
    rest = rest.replace(/^Souvenir\s/i, "").trim();
  }

  let wear = null;
  let wearShort = null;
  const wearMatch = rest.match(/\s*\(([^()]+)\)\s*$/);
  if (wearMatch) {
    const short = WEAR_SHORT[wearMatch[1].trim().toLowerCase()];
    if (short) {
      wear = wearMatch[1].trim();
      wearShort = short;
      rest = rest.slice(0, wearMatch.index).trim();
    }
  }

  const base = rest || name;

  // The kind segment is redundant wherever a category chip already states it,
  // so it is split off rather than stripped — the caller decides.
  let kind = null;
  let short = base;
  const kindMatch = KIND_PREFIXES.find((candidate) =>
    base.toLowerCase().startsWith(`${candidate.toLowerCase()} | `),
  );
  if (kindMatch) {
    kind = kindMatch;
    short = base.slice(kindMatch.length + 3).trim() || base;
  }

  return { base, short, kind, prefixes, wear, wearShort };
}
