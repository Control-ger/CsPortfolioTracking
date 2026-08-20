# Prompt pack — final assembly

For the tool that does the motion work. The clips in `clips/` are the footage; everything
below is direction for what gets laid over and between them.

## Master prompt (look, pacing, sound)

> Assemble a 90-second product showcase for a desktop app that tracks a Counter-Strike skin
> portfolio. Source footage is seven screen-capture clips, 1920×1080, dark UI, already in
> story order.
>
> **Look.** Let the footage carry it. The app is near-black (#0a0a0c) with a single warm red
> accent and white type — do not add colour grading, glows, drop shadows or 3D device frames
> around the desktop shots. The one exception is the mobile clip, which should sit inside a
> plain, thin phone outline.
>
> **Type.** One card per beat, lower third, left aligned. A tight geometric sans, heavy weight,
> white, no outline. Cards fade in over ~250 ms and out over ~200 ms; they never move once
> placed and they never sit over a number the viewer is meant to read. Sub-lines are one step
> smaller at 70 % opacity.
>
> **Cuts.** Hard cuts between beats. No wipes, no zooms, no push-ins. The only exception is a
> ~400 ms cross-dissolve into the outro.
>
> **Pace.** 8–10 s per beat, accelerating slightly through the middle. The security beat is the
> longest hold — it is the argument the whole thing is making.
>
> **Music.** Restrained electronic, ~100 bpm, no drop, no build-and-release cliché. It should
> read as a tool, not a crypto ad. Cut the music to near-silence for the last beat of the
> security section, then bring it back for the PWA payoff.
>
> No voiceover. No captions beyond the cards below.

## Per-beat cards

Timings assume beats 1 and 9 get built; shift by ~9 s if the cold open is dropped.

| # | In | Card | Sub | Placement note |
|---|---|---|---|---|
| 1 | 0:00 | Your CS2 portfolio. On your machine. | — | Hold until the shell finishes tinting, then out |
| 2 | 0:09 | Every position. One number. | — | Bottom left; keep clear of the hero figure |
| 3 | 0:19 | Down to the individual position. | — | Bottom left; out before the inspector opens |
| 4 | 0:29 | Find anything. Track it in one click. | — | Top right, over empty space, while results load |
| 5 | 0:37 | Track what you don't own yet. | — | Bottom left |
| 6 | 0:44 | Every patch, read for market impact. | — | Bottom left, short hold |
| 7 | 0:51 | Your API keys never leave this machine. | Password-gated vault. Memory only. Locked on every restart. | Centre-left; longest hold of the video |
| 7b | 1:00 | — | — | No card. Let the lock click play silent |
| 8 | 1:03 | And it comes with you. | — | Beside the phone, vertically centred |
| 9 | 1:11 | CS Portfolio Tracker | github.com/Control-ger/CsPortfolioTracking | Wordmark centred on the palette gradient |

## Beat 9 — outro, built from scratch

> A closing card on a near-black background with a slow, subtle gradient drifting behind it in
> deep desaturated blue-grey and a muted warm red — the colours the app derives from a Steam
> avatar. Wordmark "CS Portfolio Tracker" centred in heavy white geometric sans, repository URL
> beneath it at 60 % opacity in a monospace face. The gradient moves; nothing else does. Six
> seconds, ending on a slow fade to black.

## Beat 6 — a warning for whoever cuts this

The CS-updates clip contains **German body text** (generated market analysis from the backend,
not translatable UI). In an English video that will read as a bug. Either frame tightly on the
headlines and impact badges, cut the beat to ~4 s so the paragraphs never resolve, or drop it
and give the time to beats 3 and 7.

## If a vertical cut is wanted later

Beats 2, 3 and 4 are wide-layout and crop badly to 9:16 — the sidebar and the right-hand
inspector both fall outside frame. Beat 8 is already vertical and needs no work. A vertical cut
should be reshot at a narrow viewport rather than cropped from these files.
