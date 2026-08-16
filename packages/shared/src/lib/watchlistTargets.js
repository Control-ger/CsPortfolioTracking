/**
 * Zielpreis (target price) helpers for watchlist items — pure functions.
 *
 * A target lives on the watchlist row as four fields that are only meaningful
 * together:
 *
 *   alertPriceUsd        the target itself
 *   alertDirection       "below" (buy target) | "above" (sell target)
 *   alertAnchorPriceUsd  the live price when the target was set
 *   alertTriggeredAt     ISO timestamp of the crossing, or null
 *
 * `alertAnchorPriceUsd` exists because a progress bar needs a denominator: how
 * far the price has travelled is only answerable against where it started. A
 * bar anchored on "now" would refill itself on every price tick.
 *
 * `alertDirection` is stored, not derived at evaluation time. It is *defaulted*
 * from the price relation when the target is saved (see `suggestTargetDirection`),
 * but a user who sets a sell target below the current price must not have it
 * silently flipped into a buy target the next time the price moves.
 *
 * Everything here is USD. Watchlist rows carry `currentPrice` in EUR (the server
 * multiplies `price_usd` by `usd_to_eur` in `PriceHistoryRepository`), so the
 * live price for a comparison is taken from the price history's `priceUsd`
 * instead — see `resolveWatchlistLivePriceUsd`. Mixing the two would compare a
 * USD target against a EUR price and fire every alert roughly 8 % early.
 */

import { resolveHistoryValueUsd } from "./portfolioHelpers.js";

export const TARGET_DIRECTION_BELOW = "below";
export const TARGET_DIRECTION_ABOVE = "above";

/** Clamps to a positive 2-decimal amount, mirroring `normalizeOverpayFloor`. */
export function normalizeTargetPriceUsd(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Number(parsed.toFixed(2));
}

export function normalizeTargetDirection(value) {
  return String(value || "").trim().toLowerCase() === TARGET_DIRECTION_ABOVE
    ? TARGET_DIRECTION_ABOVE
    : TARGET_DIRECTION_BELOW;
}

export function normalizeTargetTriggeredAt(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  return Number.isFinite(Date.parse(text)) ? text : null;
}

/**
 * The four target fields of a row, normalized. Used by the local store on read,
 * by the sync/merge layer and by the UI, so all three agree on what "no target"
 * looks like.
 */
export function normalizeWatchlistTargetFields(source = {}) {
  return {
    alertPriceUsd: normalizeTargetPriceUsd(
      source?.alertPriceUsd ?? source?.alert_price_usd,
    ),
    alertDirection: normalizeTargetDirection(
      source?.alertDirection ?? source?.alert_direction,
    ),
    alertAnchorPriceUsd: normalizeTargetPriceUsd(
      source?.alertAnchorPriceUsd ?? source?.alert_anchor_price_usd,
    ),
    alertTriggeredAt: normalizeTargetTriggeredAt(
      source?.alertTriggeredAt ?? source?.alert_triggered_at,
    ),
  };
}

/**
 * Live price of a watchlist row in USD.
 *
 * `currentPrice` is deliberately not a fallback: it is EUR, and silently
 * treating it as USD is the failure this function exists to prevent. A row
 * without price history simply has no USD price, and every derived value
 * degrades to null rather than to a wrong number.
 */
export function resolveWatchlistLivePriceUsd(item) {
  const direct = Number(item?.currentPriceUsd);
  if (Number.isFinite(direct) && direct > 0) {
    return direct;
  }

  const history = Array.isArray(item?.priceHistory) ? item.priceHistory : [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const value = Number(resolveHistoryValueUsd(history[index]));
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return null;
}

/** Default direction when a target is saved: below the live price is a buy target. */
export function suggestTargetDirection(targetPriceUsd, livePriceUsd) {
  const target = Number(targetPriceUsd);
  const live = Number(livePriceUsd);
  if (!Number.isFinite(target) || !Number.isFinite(live) || live <= 0) {
    return TARGET_DIRECTION_BELOW;
  }
  return target > live ? TARGET_DIRECTION_ABOVE : TARGET_DIRECTION_BELOW;
}

/**
 * Everything the UI needs about a row's target.
 *
 * `progressPercent` is null — not 0 — whenever it cannot be computed (no anchor,
 * no live price, anchor already on the target's side). Zero percent is a claim
 * about the price; null is the absence of one, and the bar renders empty rather
 * than "no progress made".
 */
export function resolveWatchlistTarget(item) {
  const { alertPriceUsd, alertDirection, alertAnchorPriceUsd, alertTriggeredAt } =
    normalizeWatchlistTargetFields(item);
  const livePriceUsd = resolveWatchlistLivePriceUsd(item);

  if (alertPriceUsd === null) {
    return {
      hasTarget: false,
      targetPriceUsd: null,
      direction: alertDirection,
      anchorPriceUsd: null,
      livePriceUsd,
      progressPercent: null,
      distancePercent: null,
      reached: false,
      triggeredAt: null,
    };
  }

  const reached =
    livePriceUsd === null
      ? false
      : alertDirection === TARGET_DIRECTION_ABOVE
        ? livePriceUsd >= alertPriceUsd
        : livePriceUsd <= alertPriceUsd;

  const distancePercent =
    livePriceUsd === null
      ? null
      : ((alertPriceUsd - livePriceUsd) / livePriceUsd) * 100;

  let progressPercent = null;
  if (livePriceUsd !== null && alertAnchorPriceUsd !== null) {
    const span = alertPriceUsd - alertAnchorPriceUsd;
    if (Math.abs(span) > 0) {
      const travelled = livePriceUsd - alertAnchorPriceUsd;
      const ratio = (travelled / span) * 100;
      progressPercent = Math.min(100, Math.max(0, ratio));
    }
  }

  return {
    hasTarget: true,
    targetPriceUsd: alertPriceUsd,
    direction: alertDirection,
    anchorPriceUsd: alertAnchorPriceUsd,
    livePriceUsd,
    progressPercent,
    distancePercent,
    reached,
    triggeredAt: alertTriggeredAt,
  };
}

/**
 * Split rows into the target crossings that just happened and the ones that
 * un-crossed.
 *
 * Only *transitions* are reported. Reporting every reached target on every load
 * would notify on each watchlist refresh, and `createNotification`'s built-in
 * dedupe cannot absorb that: it keys on title+message, and the message carries
 * the current price, which changes constantly.
 */
export function evaluateWatchlistTargetAlerts(items = []) {
  const triggered = [];
  const cleared = [];

  (Array.isArray(items) ? items : []).forEach((item) => {
    const target = resolveWatchlistTarget(item);
    if (!target.hasTarget || target.livePriceUsd === null) {
      return;
    }
    if (target.reached && !target.triggeredAt) {
      triggered.push({ item, target });
      return;
    }
    if (!target.reached && target.triggeredAt) {
      cleared.push({ item, target });
    }
  });

  return { triggered, cleared };
}
