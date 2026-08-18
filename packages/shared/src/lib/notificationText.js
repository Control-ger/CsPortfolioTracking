import { translate } from "./i18n/index.js";

/**
 * Display text for one `sync_notifications` row.
 *
 * Rows are persisted, so their text outlives the language it was written in.
 * Since the key columns exist, a writer stores `title_key`/`message_key` plus
 * the interpolation `params`, and the rendered text alongside as a fallback:
 *
 *   - **key present** — translate it now, so a language switch retranslates
 *     the whole history rather than leaving each row in whichever language
 *     happened to be active when it was written;
 *   - **no key** — fall back to the stored text. That covers every row written
 *     before the key columns existed, and it is why `title`/`message` are still
 *     written rather than left empty.
 *
 * Callers must be components that already subscribe via `useTranslation`;
 * `translate` reads the catalogue but does not trigger a re-render on its own.
 */
export function resolveNotificationText(entry) {
  const params = entry?.params && typeof entry.params === "object" ? entry.params : undefined;

  const title = entry?.titleKey ? translate(entry.titleKey, params) : entry?.title || "";
  const message = entry?.messageKey ? translate(entry.messageKey, params) : entry?.message || "";

  return { title, message };
}
