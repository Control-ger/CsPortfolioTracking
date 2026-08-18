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
  - The download retries up to 3 times with linear backoff on network/5xx errors; a 4xx
    aborts immediately, since a wrong pinned version cannot fix itself by retrying.
    Rationale: the release jobs are per-platform and independent. When this step failed
    once (observed on `v0.2.103`), every later Linux step was skipped while the Windows
    job still published the tag — the resulting Windows-only release became "latest" and
    its missing `latest-linux.yml` broke auto-update for **all** existing Linux users.
- electron-builder embeds it per platform via `linux.extraResources` / `win.extraResources`.
- The binaries are git-ignored (`resources/php/`) and re-fetched on every build.
- Runtime selection (`resolvePhpBinary` → `isStatic`), the static `php.static.ini`, and the
  injected `curl.cainfo`/`openssl.cafile` are described in `docs/architecture-overview.md` §3.1.

## Server image PHP extensions

The web container (`Dockerfile`, `php:8.2-apache`) installs:

- `pdo`, `pdo_mysql`, `curl` — application baseline.
- `apcu` (via `pecl`) — shared-memory backend for the HTTP rate limiter, configured in
  `/usr/local/etc/php/conf.d/apcu-ratelimit.ini` (`apc.enabled=1`, `apc.enable_cli=0`,
  `apc.shm_size=32M`).

APCu is a **performance** dependency, not a correctness one: without it `RequestRateLimiter`
falls back to a locked JSON file, which still enforces the same limits but serializes every
limited request on one exclusive lock. `apc.enable_cli` stays off because the CLI crons do not
rate-limit; the store probes `apcu_enabled()` and falls back accordingly. If the extension is
dropped from the image, rate limiting keeps working — it just gets slower under concurrency.

## Server image logging

The observability `FileSink` appends to `/var/www/html/logs/app.log`. The Dockerfile creates that
directory and chowns it to `www-data`, because every `COPY` lands root-owned while Apache serves
as `www-data`.

This is not cosmetic. Without the chown, the sink's silenced `@file_put_contents` fails for
**every web request**, so no request-scoped event is ever recorded — while the root-owned CLI
crons keep appending to the same file, leaving a log that looks perfectly healthy. Observed
consequence: the auth gate's observe mode reported zero `security.auth.request_denied` entries,
which was read as "no unauthenticated traffic" when in truth nothing web-facing was being logged
at all.

`docker-compose.yml` bind-mounts `${PROJECT_ROOT_PATH}/logs` so `app.log` survives the container
replacement that every Watchtower update performs — otherwise no observation window can span more
than one image pull. **The host directory must be owned by UID 33 (`www-data`)**: a bind mount
overlays the image's ownership, so a root-owned host directory reproduces exactly the failure the
Dockerfile `chown` fixes.

`backend/.htaccess` ships in the image and routes the bare `/api/v1/...` form to the front
controller. Without it Apache falls through to the SPA rewrite at the document root and answers
API calls with frontend HTML at status 200. It belongs in the image rather than in a host bind
mount: `create_host_path: true` silently creates a *directory* when the source file is missing,
and a directory mounted over `.htaccess` disables the rule while looking configured.

The build-time `chown` alone is not sufficient once that bind mount exists: the host directory's
ownership overlays the image layer. Worse, two processes append to the same file with different
uids — Apache/PHP as `www-data`, the supervisord crons as root — and whichever creates `app.log`
first owns it. A root-created file locks `www-data` out again, silently. `docker-entrypoint.sh`
therefore runs as root at container start, creates the file if missing and chowns directory and
file to `www-data`, before any writer runs. Owning it as `www-data` satisfies both writers, since
root ignores file permissions.

Two follow-ups from that:

- `FileSink` reports an unwritable log path once per process via `error_log`, so the failure is
  no longer invisible.
- `php://stderr` from mod_php does **not** surface in `docker logs` in this image. `app.log` is
  the only usable source; grep it inside the container:
  `docker exec csportfolio-web grep … /var/www/html/logs/app.log`.

## Icons

- Windows: `icon.ico` (repo root). Linux: `build/icon.png` (≥256×256, extracted from `icon.ico`;
  without it electron-builder falls back to the default icon).

## Local guards

Run before every push, alongside `npm run lint`:

- `npm run docs:guard` — documentation governance (see `AGENTS.md`).
- `npm run i18n:guard` — catalogue integrity. Two things neither ESLint nor the
  build can see, because a missing translation key is not a syntax error — it
  renders as the raw key path in the UI:
  - a key present in one language but not the other. English is the source
    language, so a key missing from German is a **warning** (it falls back to a
    complete English string) while a key missing from English is an **error**
    (there is nothing to fall back to);
  - a `t("…")` / `translate("ns:…")` call whose key is in no catalogue. The
    namespace is taken from the `useTranslation(...)` call in the same file, or
    from the `ns:` prefix / the `{ ns: … }` option when either is present.

  Keys built at runtime (template literals) are skipped — `resolveItemCategory`
  and the match-reason lookup build theirs from a data key, and both fall back
  to something usable when the key is missing.

`eslint-plugin-i18next`'s `no-literal-string` runs as a **warning** over the
component and page directories. It cannot tell a label from an acronym, a brand
name or a unit, and this codebase legitimately renders "CSFloat", "ROI" and
"24h" as literals — it is a prompt to check, not a gate.

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
