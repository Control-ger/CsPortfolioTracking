# Showcase video — shot list

~90 s, 16:9, English, on-screen text only (no voiceover), music underneath.
Story: **Electron desktop as the lead → security beat → PWA as the payoff.**

Captured over CDP against the running dev app (Electron 41 / `--remote-debugging-port=9222`),
1536×866 CSS at dpr 1.25, which lands on exactly 1920×1080. Dark theme throughout.

## Status

| # | Beat | Clip | Length | State |
|---|---|---|---|---|
| 1 | Cold open — vault unlock | `clips/01-cold-open.mp4` | 9.0 s | done |
| 2 | Dashboard, hero scrub | `clips/02-dashboard.mp4` | 10.1 s | done |
| 3 | Inventory + item detail | `clips/03-inventory.mp4` | 10.3 s | done |
| 4 | Search → add position | `clips/04-search.mp4` | 8.1 s | done |
| 5 | Watchlist | `clips/05-watchlist.mp4` | 6.5 s | done |
| 6 | CS updates feed | `clips/06-updates.mp4` | 7.2 s | done |
| 7 | API keys + vault | `clips/07-apikeys.mp4` | 8.7 s | done |
| 7b | Vault locks | `clips/07b-lock.mp4` | 4.8 s | done |
| 8 | PWA / mobile | `clips/08-pwa.mp4` (518×1080)<br>`clips/08-pwa-16x9.mp4` (padded) | 7.6 s | done |
| 9 | Outro wordmark | — | ~6 s | to build in the editor |

`rough-cut.mp4` — the nine captured beats concatenated, silent, 72.3 s. Not the final edit; it
exists so the pacing can be judged before any motion work starts. Only the outro is missing,
which is built in the editor rather than captured.

## The vault beats

Both came out of one continuous take (`clips/vault-take-full.mp4` in the scratchpad, 26.7 s),
split afterwards so the lock and the unlock share the same framing and cursor position.

There is **no "Lock now" button** — the Secret Vault card carries only status badges and the
auto-lock toggle. An earlier draft of this list claimed otherwise. The lock is triggered through
`window.electronAPI.secrets.lockVault()`; the fall back to the lock screen is genuine app
behaviour, there is simply no click to film.

The password was entered with a password manager, not typed, so beat 1 has no typing animation
— the field jumps from empty to filled. The masked field means nothing sensitive is in frame.

⚠️ **The unlock reveals Settings, not the Dashboard**, because the app returns to the route it
was on. As a cold open that resolves onto a form instead of onto the portfolio. See the note at
the end of this file.

## Beat detail

### 2 — Dashboard *(10.1 s)*
Portfolio hero on the MAX range, then the mouse glides right-to-left across the curve.
**The hero number scrubs with the cursor** — €1,486.88 becomes the value at the hovered day,
and the ROI figure follows. That live rewrite is the shot, not the static chart.

> **"Every position. One number."**

### 3 — Inventory *(10.3 s)*
Sorted by ROI. Scrolls the table, then clicks a row to open the detail inspector: price-trend
chart, purchase, break-even. Sparkline per row, item thumbnails throughout.

> **"Down to the individual position."**

### 4 — Search *(8.1 s)*
Types "Souvenir" into the global bar, Enter, 3892 hits resolve into a card grid — thumbnails,
prices, condition badges, "Add to watchlist" per card, one card already showing it is tracked.

> **"Find anything. Track it in one click."**

Note: the first uncached run of a broad query takes ~8–10 s over the Cloudflare tunnel. This
clip was shot with the query warm. If it is ever reshot, warm it first or the beat is all spinner.

### 5 — Watchlist *(6.5 s)*
Tracked-but-not-owned items with live prices, 24h/7D/30D deltas and target-price meters.

> **"Track what you don't own yet."**

### 6 — CS updates *(7.2 s)*
Patch and VAC-wave feed with market-impact assessments.

> **"Every patch, read for market impact."**

⚠️ **The analysis text in this feed is German** and cannot be translated — it is generated
content served by the backend, not UI copy. Either frame the shot on the headlines and
badges, keep the beat short, or drop it. This is the one surface the i18n work could not fix.

### 7 — API keys and vault *(8.7 s)*
Settings → Connections. The app makes the claim itself, on screen:

- *"API keys — Keys live in the Secret Vault and never leave the device."*
- CSFloat key masked, showing only validity
- *"Secret Vault — Encrypted storage for keys and sessions. Unlock is required after every app start."*

> **"Your API keys never leave this machine."**
> Sub: *"Password-gated vault. Memory only. Locked on every restart."*

⚠️ The CSFloat row shows the key's last four characters ("ends in r2dN") and the server host
`cs2.clustercontrol.cc` is visible in the header. Not enough to reconstruct a key, but worth a
blur in the edit if you would rather not publish either.

### 8 — PWA *(7.6 s)*
Same portfolio at 390×844: MobileTopbar, compact stat tiles, full chart, then the hamburger
opens the drawer nav. Shot by putting the **Electron** window into mobile emulation rather than
the web build — the web runtime would have needed its own Steam login. Same React components,
same `lg:` breakpoint, and no browser chrome to hide.

The Electron titlebar is cropped out (`crop=488:1016:0:38`), so the clip drops straight into a
phone mockup frame.

> **"And it comes with you."**

## Open decision — where the cold open lands

The unlock currently resolves onto the Settings page. It is truthful (the app restores the last
route) but it is a weak payoff: the video's opening beat ends on a form full of API-key rows
rather than on the portfolio.

A reshoot fixes it — navigate to the Dashboard first, then lock, then unlock, and the reveal
lands on the hero figure and the curve. That costs one more password-manager unlock.

If a reshoot is not wanted, the edit can cut away from beat 1 roughly 400 ms after the shell
appears, before Settings is legible, and let beat 2 supply the dashboard. That reads as a match
cut rather than a mistake, and needs nothing further.

## Reproducing a capture

The harness lives in the session scratchpad (`lib.mjs`, `shots.mjs`), not in the repo — it is
throwaway, matching how the README screenshots were made. Two things it has to get right:

- **Navigate by clicking the sidebar rail, not by setting `location.hash`.** Hash-only
  navigation does not re-render the route reliably, and the rail's hover/active states are
  worth filming anyway.
- **Check `dist/assets/index-*.js` actually rebuilt** before rolling. The vite watcher goes
  quiet and it is easy to film a stale bundle.

Frames come from CDP `Page.startScreencast` as JPEG with their real timestamps, written to an
ffconcat manifest so the inter-frame timing survives into ffmpeg. Encode:

```bash
ffmpeg -f concat -safe 0 -i frames.ffconcat -vf "scale=1920:1080:flags=lanczos,format=yuv420p" -r 30 -c:v libx264 -crf 19 out.mp4
```
