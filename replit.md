# Smart AI Togel

Self-learning lottery prediction system with 100+ AI engines for Macau and Hongkong pasarans.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string (auto-provisioned)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Scraping: cheerio + node-fetch (masterlive.net for Macau, angkanets.org for HK)

## Where things live

- `artifacts/api-server/src/lib/` — AI engine libraries
  - `prediction-engine.ts` — 100 prediction engines (markov, gap, bayes, stat, pattern, nn, ts, shio, momentum)
  - `smart-ai-engine.ts` — 7 Smart AI engines (A–G) slot-aware
  - `smart-ai-weights.ts` — adaptive per-pasaran weights stored in DB
  - `learning-engine.ts` — self-learning: evaluates predictions vs. actual results, adjusts weights
  - `laporan-engine.ts` — LOO backtest report engine
  - `deep-analysis.ts` — deep statistical analysis per time slot
  - `scraper.ts` — scrapes historical draw data from web sources
  - `scheduler.ts` — cron-style scheduler: auto-sync + predict on each draw slot
- `artifacts/api-server/src/routes/` — Express route handlers (results, predict, deep, smart-ai, laporan)
- `lib/db/src/schema/lottery.ts` — 6 DB tables (lottery_results, predictions, prediction_accuracy, engine_weights, smart_ai_weights, miss_analysis)
- `lib/api-spec/openapi.yaml` — source-of-truth API contract (1520 lines)

## Architecture decisions

- **Contract-first API**: OpenAPI spec → Orval codegen → Zod schemas + React Query hooks
- **Only macau and hongkong pasarans** — never sgp/hkg/sdy; validated at every entry point
- **Out-of-sample scoring only**: predictions are never scored against data they were trained on; evaluateAndLearn only scores once a genuinely new draw arrives
- **Honest failure over fake data**: scraper never fabricates results; endpoints return 422 if insufficient real draws exist
- **Adaptive weights**: engine weights per pasaran update automatically via LOO backtest on every scheduler cycle

## Product

- **Results**: fetch, sync, and query lottery draw history for Macau (6 slots/day) and HK (1 slot/day)
- **Prediction**: run 100 AI engines with adaptive weights → 4D/3D/2D consensus + BBFS5/6 + Colok Bebas
- **Smart AI**: slot-aware 7-engine analysis with per-slot draw history
- **Deep Analysis**: time-slot statistical deep dive
- **Laporan**: LOO backtest accuracy report per pasaran/slot
- **Self-learning**: scheduler auto-runs after each draw slot, evaluates accuracy, updates weights

## Scheduler

Runs automatically on server start. For Macau: syncs + predicts at 00:01, 13:00, 16:00, 19:00, 22:00, 23:00 WIB. For HK Lotto: 23:00 WIB.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Always call `pnpm --filter @workspace/api-spec run codegen` after changing `lib/api-spec/openapi.yaml`
- Always call `pnpm --filter @workspace/db run push` after changing `lib/db/src/schema/lottery.ts`
- DB schema uses `periode` (text, unique) as natural dedup key for lottery_results
- Scraper targets: masterlive.net (Macau), angkanets.org (HK)

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
