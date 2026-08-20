# Claude Design — paste-ready prompt

Everything below is self-contained. Nothing depends on fetching a URL or reading a repo path,
because Claude Design can do neither: artifacts are private unless explicitly shared, and it has
no access to the local filesystem.

**Before pasting:** attach `docs/video/showcase-v1.mp4` with the `+` button (78 s, 1920×1080,
7.7 MB, silent). If the upload is refused, attach `rough-cut.mp4` (4.3 MB, no text cards) or the
individual clips from `docs/video/clips/`.

Keep the **CS Investor Hub UI** design system selected and the **Animation** template.

---

## The prompt

> Build a ~80-second product trailer for **CS Portfolio Tracking**, a desktop app that tracks a
> Counter-Strike 2 skin portfolio. I have attached a finished silent cut — treat it as the
> reference for structure, pacing and content, and rebuild the text and transitions properly.
> The screen footage in it is final; do not regenerate or fake any UI.
>
> **The three things the trailer must land, in this order:**
> 1. It is a real native desktop app (Electron), not a website in a wrapper.
> 2. API keys never leave the machine — they live in a password-gated local vault.
> 3. There is a read-only mobile companion (PWA) so you can check the portfolio on the go.
>
> **Beat structure** (timings from the attached cut):
>
> | # | In | Length | What is on screen | Card |
> |---|---|---|---|---|
> | 1 | 0:00 | 8.6 s | Vault lock screen, password fills, "Unlocking… 100 %" | Your CS2 portfolio. On your machine. |
> | 2 | 0:08 | 10.3 s | Dashboard; the hero figure scrubs live as the cursor crosses the curve | Every position. One number. |
> | 3 | 0:19 | 10.3 s | Inventory table sorted by ROI, then the item detail inspector opens | Down to the individual position. |
> | 4 | 0:29 | 8.1 s | Search "Souvenir", 3892 results resolve into a card grid | Find anything. Track it in one click. |
> | 5 | 0:37 | 6.5 s | Watchlist with live prices and target meters | Track what you don't own yet. |
> | 6 | 0:44 | 7.2 s | CS2 patch feed with market-impact assessments | Every patch, read for market impact. |
> | 7 | 0:51 | 8.7 s | Settings: masked API keys, Secret Vault card | **Your API keys never leave this machine.**<br>sub: Password-gated vault. Memory only. Locked on every restart. |
> | 7b | 1:00 | 4.8 s | The vault locks; the app falls back to the lock screen | *(no card — let it play silent)* |
> | 8 | 1:05 | 7.6 s | The same portfolio at phone size, drawer nav opens | And it comes with you. |
> | 9 | 1:12 | 6.0 s | Wordmark on a drifting gradient | CS Portfolio Tracking<br>github.com/Control-ger/CsPortfolioTracking |
>
> **The one cut that must not be softened:** beat 1 ends on the lock screen at "Unlocking… 100 %"
> and beat 2 opens on the dashboard. The edit performs the reveal the app does not. Hard cut —
> no dissolve, no hold, no card bridging the two.
>
> **Look.** Let the footage carry it. The UI is near-black `#0A0A0C` with one warm red accent
> `#E8503A` and white type. No colour grading, no glows, no drop shadows, no 3D device frames
> around the desktop shots. The one exception is beat 8, which should sit inside a plain thin
> phone outline — it is already cropped to a phone aspect with no browser chrome.
>
> **Type.** One card per beat, lower third, left aligned, heavy geometric sans in white. Cards
> fade in over ~250 ms and out over ~200 ms; they never move once placed. The sub-line on beat 7
> is one step smaller at 70 % opacity. Keep cards clear of the big currency figures — on the
> dashboard the hero number sits upper-left, so the card belongs bottom-left.
>
> **Cuts.** Hard cuts between beats. No wipes, no zooms, no push-ins. The only exception is a
> ~400 ms cross-dissolve into the outro.
>
> **Pace.** 8–10 s per beat, accelerating slightly through the middle. Beat 7 gets the longest
> hold — it is the argument the whole thing is making. Beat 7b plays silent right after it.
>
> **Music.** Restrained electronic, ~100 bpm, no drop, no build-and-release cliché. It should
> read as a tool, not a crypto ad. Drop to near-silence under beat 7b, then bring it back for
> beat 8.
>
> **Outro.** Near-black with a slow drifting gradient behind it in deep desaturated blue-grey
> `#1E3E4A` and muted warm red `#60261C` — the colours the app derives from a Steam avatar.
> Wordmark centred in heavy white sans, repository URL beneath at ~60 % opacity in monospace.
> The gradient moves; nothing else does. Ends on a slow fade to black.
>
> **No voiceover. No captions beyond the cards above.**
>
> **Two things to work around:**
> - Beat 6's feed body text is German (it is generated content from the backend, not UI copy).
>   Frame tight on the headlines and impact badges, or cut the beat to ~4 s so the paragraphs
>   never resolve.
> - Beat 7 shows the last four characters of an API key and a server hostname. Blur both.

---

## Notes for Maik, not for the prompt

**The naming.** The app answers to two names: `productName` in `package.json` is "CS Investor
Hub" (installer, process, lock screen) while the in-app titlebar renders "CS Portfolio Tracking"
from the i18n catalogue. The trailer uses **CS Portfolio Tracking**, matching what is visible in
every frame. The lock screen in beat 1 still says "Welcome to CS Investor Hub", so the two names
do appear in the same video. Worth unifying in the app at some point.

**If a vertical cut is wanted.** Beats 2, 3 and 4 are wide-layout and crop badly to 9:16 — the
sidebar and the right-hand inspector fall outside frame. Beat 8 is already vertical. A vertical
cut should be reshot at a narrow viewport rather than cropped from these files.
