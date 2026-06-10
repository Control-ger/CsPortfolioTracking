# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Ask Mode (Non-Obvious)

- **`docs/architecture-overview.md` is the sole architecture truth** — it contains the Active Docs table (§7) that indexes all relevant documentation files. Any `.md` file not listed there may be stale or historical.
- **`docs/archive/` is graveyard** — files like [`docs/archive/MONOREPO_MIGRATION_STATUS.md`](docs/archive/MONOREPO_MIGRATION_STATUS.md) and [`docs/archive/repo-restructure-plan.md`](docs/archive/repo-restructure-plan.md) are historical records, not current state. Do not cite them as active documentation.
- **Backend docs are in `backend/` not `docs/`** — [`backend/MVC_API_CONTRACT.md`](backend/MVC_API_CONTRACT.md) is the API contract. [`backend/OBSERVABILITY_IMPLEMENTATION_PLAN.md`](backend/OBSERVABILITY_IMPLEMENTATION_PLAN.md) and [`backend/STRANGLER_ROLLOUT.md`](backend/STRANGLER_ROLLOUT.md) are in-progress plans. These live beside the code, not in the shared `docs/` directory.
- **`README.md` is intentionally thin** — setup/screenshots only. Architecture, sync strategies, DB schemas, roadmaps, and technical decisions are explicitly prohibited from `README.md` by governance rules.
- **All gradients use Steam palette** — CSS variables `--steam-shell-color-a` through `--steam-shell-color-d`. Derived from `deriveSteamPaletteFromUser()` in [`SteamLoginPrompt.jsx`](packages/shared/src/components/SteamLoginPrompt.jsx). Never add hardcoded gradient colors.
- **`@shared/*` and `@/*` are identical** — both map to `packages/shared/src/`. When asked about import aliases, there are only two targets: shared and apps.
