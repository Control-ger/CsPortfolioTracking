#!/usr/bin/env node

/**
 * Catalogue guard.
 *
 * Two failure modes that neither ESLint nor the build can see, because a
 * missing key is not a syntax error — it renders as the raw key path in the UI:
 *
 *   1. a key that exists in one language but not the other;
 *   2. a `t("…")` / `translate("ns:…")` call whose key is in no catalogue.
 *
 * English is the source language, so a key missing from German is a warning
 * (it falls back to a complete English string) while a key missing from
 * English is an error (nothing to fall back to).
 */

import fs from "node:fs";
import path from "node:path";

const LOCALES_DIR = "packages/shared/src/lib/i18n/locales";
const SOURCE_DIRS = ["packages/shared/src", "apps/web/src"];
const SOURCE_IGNORE = /DesignSystemPage|csUpdatesFeed\.mock|[/\\]i18n[/\\]locales[/\\]/;

function flatten(value, prefix = "") {
  return Object.entries(value).flatMap(([key, entry]) =>
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? flatten(entry, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

function readCatalogues(language) {
  const dir = path.join(LOCALES_DIR, language);
  const out = new Map();
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const namespace = file.replace(/\.json$/, "");
    out.set(namespace, new Set(flatten(JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")))));
  }
  return out;
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(full);
    if (!/\.jsx?$/.test(entry.name)) return [];
    return SOURCE_IGNORE.test(full) ? [] : [full];
  });
}

const en = readCatalogues("en");
const de = readCatalogues("de");
const errors = [];
const warnings = [];

// 1. symmetry
for (const [namespace, enKeys] of en) {
  const deKeys = de.get(namespace);
  if (!deKeys) {
    errors.push(`namespace "${namespace}" has no German catalogue`);
    continue;
  }
  for (const key of enKeys) {
    if (!deKeys.has(key)) warnings.push(`de/${namespace}.json missing "${key}"`);
  }
  for (const key of deKeys) {
    if (!enKeys.has(key)) errors.push(`en/${namespace}.json missing "${key}" (present in German)`);
  }
}

// 2. every referenced key resolves.
//    i18next plural keys are stored as `<key>_one` / `<key>_other`, so a call
//    site referencing the bare `<key>` is satisfied by either suffix.
const CALL = /\b(?:t|translate)\(\s*["'`]([^"'`]+)["'`]([^)]*)\)/g;
const HOOK = /useTranslation\(\s*(\[[^\]]*\]|["'][^"']+["'])/g;

/** Namespaces a bare `t("…")` in this file could resolve against. */
function fileNamespaces(source) {
  const found = new Set();
  for (const match of source.matchAll(HOOK)) {
    for (const ns of match[1].matchAll(/["']([^"']+)["']/g)) found.add(ns[1]);
  }
  return [...found];
}

for (const dir of SOURCE_DIRS) {
  for (const file of walk(dir)) {
    const source = fs.readFileSync(file, "utf8");
    const scoped = fileNamespaces(source);

    for (const match of source.matchAll(CALL)) {
      const raw = match[1];
      const options = match[2] || "";
      if (raw.includes("${") || !raw.trim()) continue; // built at runtime

      // `t("key", { ns: "other" })` overrides the hook's namespace.
      const explicitNs = /\bns:\s*["']([^"']+)["']/.exec(options)?.[1];
      const [prefixNs, tail] = raw.includes(":") ? raw.split(":") : [null, raw];
      const candidates = prefixNs ? [prefixNs] : explicitNs ? [explicitNs] : scoped;

      if (candidates.length === 0) continue; // no hook in scope — nothing to check against
      const unknown = candidates.filter((ns) => !en.has(ns));
      if (unknown.length === candidates.length) {
        errors.push(`${file}: unknown namespace "${unknown[0]}" in "${raw}"`);
        continue;
      }
      const resolves = candidates.some((ns) => {
        const keys = en.get(ns);
        return keys && (keys.has(tail) || keys.has(`${tail}_other`));
      });
      if (!resolves) {
        errors.push(`${file}: unresolved key "${raw}" (namespaces: ${candidates.join(", ")})`);
      }
    }
  }
}

// 3. no German text left in the source.
//    English is the source language, so any German outside the catalogues is a
//    string that was never migrated. ESLint's i18next/no-literal-string sees
//    these too, but it also flags ~120 legitimate literals (units, symbols,
//    debug output), so the signal drowns. Looking specifically for German is
//    the check that stays actionable.
const GERMAN_WORD =
  /\b(?:der|die|das|den|dem|des|ein|eine|einen|einem|einer|und|oder|nicht|kein|keine|keinen|mit|für|auf|von|aus|zum|zur|im|am|ist|sind|hat|haben|wird|werden|wurde|noch|nur|bis|beim|vom|über|unter|nach|vor|seit|ohne|durch|gegen|wenn|dann|dabei|damit|diesem|dieser|diese|erst|schon|sehr|hier|dort|jede[rs]?|alle[rs]?|Treffer|Gesamtwert|Positionen|Gruppen?|Verlauf|Zielpreis|Anzahl|Menge|Gewinn|Verlust|Summe|Katalog|Auswahl|Bestand|Gekauft|Verkauft|Käufe|Kaeufe|Spanne|Zeitraum)\b/;

/**
 * Words that appear in German catalogue values but never in English ones. A
 * hand-written stopword list only ever catches the German someone thought of;
 * this derives the project's own vocabulary ("Zuwachs", "Einkaufspreis") from
 * the catalogues, so it grows with the app instead of going stale.
 */
function germanOnlyVocabulary() {
  const words = (catalogues) => {
    const set = new Set();
    for (const dir of catalogues) {
      for (const file of fs.readdirSync(path.join(LOCALES_DIR, dir))) {
        if (!file.endsWith(".json")) continue;
        const walkValues = (node) => {
          if (typeof node === "string") {
            for (const word of node.match(/[\p{L}]{4,}/gu) || []) set.add(word.toLowerCase());
          } else if (node && typeof node === "object") {
            Object.values(node).forEach(walkValues);
          }
        };
        walkValues(JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, dir, file), "utf8")));
      }
    }
    return set;
  };
  const german = words(["de"]);
  const english = words(["en"]);
  return new Set([...german].filter((word) => !english.has(word)));
}

const GERMAN_VOCAB = germanOnlyVocabulary();

/** Strip comments and import paths — only user-facing text should be checked. */
function stripNonUiText(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*import\s[\s\S]*?from\s*["'][^"']+["'];?$/gm, "");
}

for (const dir of SOURCE_DIRS) {
  for (const file of walk(dir)) {
    const source = stripNonUiText(fs.readFileSync(file, "utf8"));
    source.split("\n").forEach((line, index) => {
      if (/\bconsole\.(log|warn|error|info|debug)\b/.test(line)) return; // not user-facing
      const where = `${file}:${index + 1}: German text in source — "${line.trim().slice(0, 80)}"`;

      // Umlauts alone are too weak a signal (they appear in item names and in
      // locale identifiers), so an error needs a German function word.
      if (GERMAN_WORD.test(line)) {
        errors.push(where);
        return;
      }
      // The catalogue-derived vocabulary is a broader net and occasionally
      // catches a property name or an English homograph, so it only warns.
      const quoted = line.match(/["'`>][^"'`<]{2,}/g) || [];
      const vocabHit = quoted.some((chunk) =>
        (chunk.match(/[\p{L}]{4,}/gu) || []).some((word) => GERMAN_VOCAB.has(word.toLowerCase())),
      );
      if (vocabHit) warnings.push(where);
    });
  }
}

for (const warning of warnings) console.warn(`[i18n-guard] WARN  ${warning}`);
for (const error of errors) console.error(`[i18n-guard] ERROR ${error}`);

if (errors.length > 0) {
  console.error(`\n[i18n-guard] FAILED — ${errors.length} error(s), ${warnings.length} warning(s)`);
  process.exit(1);
}
console.log(`[i18n-guard] OK — ${warnings.length} warning(s)`);
