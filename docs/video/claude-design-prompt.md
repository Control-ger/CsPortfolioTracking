# Claude Design — paste-ready prompt

Self-contained: nothing depends on fetching a URL or reading a repo path, because Claude Design
can do neither. Attach `docs/video/showcase-v1.mp4` (78 s, 1920×1080, 7.7 MB, silent) with the
`+` button. Keep the **CS Investor Hub UI** design system and the **Animation** template.

**Direction:** energetic app-trailer cut with an AI voiceover, text cards supporting rather than
carrying. This deliberately overrides the restrained direction in `prompts.md` — that file
describes the silent, card-led version that `showcase-v1.mp4` was built as.

---

## The prompt

> Build a fast, energetic ~62-second product trailer for **CS Portfolio Tracking**, a desktop app
> that tracks a Counter-Strike 2 skin portfolio. I have attached a finished 78-second silent cut.
> Its screen footage is final — do not regenerate, recreate or fake any UI. Re-time it, add
> motion, add a voiceover.
>
> **Cut it tighter than the reference.** Trim each beat to the target length below, front-loading
> the moment that matters and dropping the approach. The reference is a slow reference edit; this
> should feel like a real app trailer — momentum from the first frame, never resting on a static
> screen for more than about two seconds.
>
> **The three things the trailer must land, in order:** it is a real native desktop app, not a
> website in a wrapper; API keys never leave the machine; and there is a read-only mobile
> companion so you can check the portfolio anywhere.
>
> ### Beats, voiceover and cards
>
> | # | Target | On screen | Voiceover | Card |
> |---|---|---|---|---|
> | 1 | 5 s | Vault lock screen, password fills, "Unlocking… 100 %" | *"Your CS2 portfolio. Locked to your machine."* | On your machine. |
> | 2 | 8 s | Dashboard; the hero figure scrubs live as the cursor crosses the curve | *"Every case, every skin, every sticker — one number, live."* | One number. |
> | 3 | 8 s | Inventory sorted by ROI, then the detail inspector opens | *"Drill into any position. Buy-in, break-even, the full price history."* | Down to the position. |
> | 4 | 6 s | Search "Souvenir", results resolve into a card grid | *"Search thousands of items. Track one in a click."* | Track it in a click. |
> | 5 | 5 s | Watchlist with live prices and target meters | *"Watch what you don't own yet, and see the gap to your target close."* | Before you buy. |
> | 6 | 4 s | CS2 patch feed with impact badges | *"Every patch, read for market impact."* | Every patch. |
> | 7 | 9 s | Settings: masked API keys, Secret Vault card | *"And your API keys? They never leave this machine. Password-gated vault. Memory only. Locked on every restart."* | **Your API keys never leave this machine.** |
> | 7b | 3 s | The vault locks; the app falls back to the lock screen | *(silent — no VO, music drops out)* | *(no card)* |
> | 8 | 7 s | The same portfolio at phone size, drawer nav opens | *"And it comes with you. Read-only, on your phone."* | It comes with you. |
> | 9 | 6 s | Wordmark on a drifting gradient | *"CS Portfolio Tracking."* | CS Portfolio Tracking<br>github.com/Control-ger/CsPortfolioTracking |
>
> ### Voiceover
>
> A single AI voice. Confident and dry, a developer showing you something they built — not an
> announcer, no hard sell, no rising infomercial cadence. Slightly forward energy to match the
> cut. Let it breathe around beat 7: a short pause before *"And your API keys?"* so the line
> lands, then deliver the three clauses flat and certain.
>
> Beat 7b is the only silence in the piece. Nothing said, music pulled to almost nothing, just
> the app locking itself. Then beat 8 comes back up.
>
> ### Motion
>
> This is where it should feel like a trailer rather than a screen recording:
>
> - **Slow push-ins** on the static beats — roughly 2–4 % scale over the length of a beat, never
>   a hard zoom. The dashboard and the settings beat both benefit.
> - **Snap-cut on the beat** of the music at each transition. Whip-pans or quick directional
>   slides between beats are fine; keep them under 150 ms so they read as energy, not as an effect.
> - **Speed-ramp the scrolls and the typing** — the inventory scroll and the search typing are
>   slow in the source. Ramp up through the middle of each and settle on the result.
> - **Kinetic type**: cards slide up ~20 px as they fade in, over ~200 ms, with a slight ease-out.
>   They hold still once placed and leave on a fast 120 ms fade. They support the voiceover, so
>   they are shorter than the spoken line — a phrase, not a sentence.
> - **Punch the numbers.** When the dashboard hero figure scrubs, briefly emphasise it — a subtle
>   scale-up or a quick highlight sweep. That live rewrite is the single best moment in the
>   footage and the reference cut undersells it.
>
> **One cut that must not be softened:** beat 1 ends on the lock screen at "Unlocking… 100 %" and
> beat 2 opens on the dashboard. Hard cut on the downbeat — no dissolve, no transition effect.
> The edit performs the reveal the app itself does not.
>
> ### Look
>
> The UI is near-black `#0A0A0C` with one warm red accent `#E8503A` and white type. Do not colour
> grade the footage, and no glows or drop shadows on the screen content. Motion and cutting carry
> the energy, not filters. Beat 8 sits inside a plain thin phone outline — it is already cropped
> to a phone aspect with no browser chrome. No 3D device frames anywhere else.
>
> Cards in a heavy geometric sans, white, lower third, left aligned, clear of the big currency
> figures. On the dashboard the hero number sits upper-left, so the card belongs bottom-left.
>
> ### Music
>
> Driving electronic, ~120 bpm, percussive, tight low end. It should push without becoming a
> festival build — no long riser into a drop. Cut the transitions to the beat. Pull it to near
> silence under beat 7b, then bring it back hard for beat 8. End on the outro fade.
>
> ### Two things to work around
>
> - Beat 6's feed body text is German — it is generated content from the backend, not UI copy.
>   Frame tight on the headlines and impact badges, and keep the beat to about four seconds so
>   the paragraphs never resolve.
> - Beat 7 shows the last four characters of an API key and a server hostname. Blur both.
>
> Do not claim the app is free, open source, or available for download — none of that is
> established. The trailer shows what it does and ends on the repository URL.

---

## Notes for Maik, not for the prompt

**Two names in one video.** The outro reads "CS Portfolio Tracking", matching the in-app
titlebar, but the beat 1 lock screen says "Welcome to CS Investor Hub" — which is the
`productName` in `package.json` and the name of the installer. Both appear in the trailer. Worth
unifying in the app.

**No licence.** There is no `LICENSE` file and `package.json` sets `"private": true`, which is
why the prompt forbids "free" and "open source" claims.

**If a vertical cut is wanted.** Beats 2, 3 and 4 are wide-layout and crop badly to 9:16 — the
sidebar and the right-hand inspector fall outside frame. Beat 8 is already vertical. Reshoot at
a narrow viewport rather than cropping these files.
