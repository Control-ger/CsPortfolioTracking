/**
 * Build-time feature flags.
 *
 * `npm run dev` is `vite build --watch`, which runs in mode `production` — so
 * `import.meta.env.DEV` is false in the dev workflow too and cannot gate
 * anything a developer still needs to see. Flags are therefore explicit
 * `VITE_*` variables, read statically at each call site so Vite can inline
 * them, and parsed here so the accepted spellings stay in one place.
 */

const TRUTHY = ["1", "true", "yes", "on"];

/** `undefined`, `""` and anything unrecognised read as off. */
export function isFlagEnabled(rawValue) {
  return TRUTHY.includes(String(rawValue ?? "").trim().toLowerCase());
}
