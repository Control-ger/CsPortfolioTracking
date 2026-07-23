# DevOps (Build, Packaging, CI, Release)

Status: FINAL
Last updated: 2026-07-23

Home for **build, packaging, CI and release** concerns. Runtime/architecture behavior lives
in `docs/architecture-overview.md`; this file owns *how the app is built, bundled, and shipped*.
`scripts/docs-guard.mjs` routes DevOps/build triggers (see below) to this doc.

## Desktop build matrix

Every desktop release ships **both** platforms, each **self-contained** (no system PHP required):

| Platform | Artifact | Local build command |
|---|---|---|
| Windows | NSIS installer (`CS-Investor-Hub-Setup-*.exe`) | `npm run build` |
| Linux | `AppImage` + Debian `.deb` (Debian/Ubuntu-based distros incl. Zorin OS) | `npm run build:linux` |

`electron-builder` detects the current OS (config in root `package.json` `build`). The native
`better-sqlite3` module is recompiled per platform during the build.

## Bundled PHP runtime

The PHP sidecar backend runs a **fully static PHP** bundled with the app, so no system PHP is
needed on any platform.

- `scripts/fetch-php.mjs` (`npm run fetch:php`, run automatically by `build` / `build:linux`)
  downloads a static-php-cli binary plus a Mozilla `cacert.pem` into `resources/php/<platform>/`:
  - Linux/macOS: `common` build (`.tar.gz`), extracted with `tar`.
  - Windows: `spc-max` build (`.zip`, a single static `php.exe`), extracted with PowerShell `Expand-Archive`.
  - Extensions compiled in: `curl`, `openssl`, `mbstring`, `sqlite3`, `pdo_sqlite`.
- electron-builder embeds it per platform via `linux.extraResources` / `win.extraResources`.
- The binaries are git-ignored (`resources/php/`) and re-fetched on every build.
- Runtime selection (`resolvePhpBinary` → `isStatic`), the static `php.static.ini`, and the
  injected `curl.cainfo`/`openssl.cafile` are described in `docs/architecture-overview.md` §3.1.

## Icons

- Windows: `icon.ico` (repo root). Linux: `build/icon.png` (≥256×256, extracted from `icon.ico`;
  without it electron-builder falls back to the default icon).

## CI workflows

- `.github/workflows/desktop-release.yml` — runs on every `v*` tag and on `workflow_dispatch`.
  Builds Windows (`build-and-release` job on `windows-2025`) and Linux (`build-linux` job on
  `ubuntu-latest`, runs after the Windows job), fetching the bundled PHP first, then attaching
  `.exe` / `AppImage` / `.deb` (+ checksums, attestations) to the GitHub release. The
  release-upload steps are gated on tag refs, so `workflow_dispatch` on a branch builds
  **without** publishing — use it to validate a branch's build (e.g. the Windows build).
- `.github/workflows/docs-governance.yml` — runs `npm run docs:guard` on PRs and pushes to main.
- `.github/workflows/web-image-release.yml` — web container image release.

## Release

Tag-driven; see `AGENTS.md` → Release Workflow for the exact version-bump/tag steps. The
`desktop-release.yml` "Validate tag matches package version" step enforces that a `vX.Y.Z` tag
matches `package.json`.
