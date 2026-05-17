# MBFD Bid

> Annual shift bid web application for the Miami Beach Fire Department.

[![CI](https://github.com/pdarleyjr/mbfd-bid/actions/workflows/ci.yml/badge.svg)](https://github.com/pdarleyjr/mbfd-bid/actions/workflows/ci.yml)
[![CodeQL](https://github.com/pdarleyjr/mbfd-bid/actions/workflows/codeql.yml/badge.svg)](https://github.com/pdarleyjr/mbfd-bid/actions/workflows/codeql.yml)
[![Deploy staging](https://github.com/pdarleyjr/mbfd-bid/actions/workflows/deploy-staging.yml/badge.svg)](https://github.com/pdarleyjr/mbfd-bid/actions/workflows/deploy-staging.yml)

A fantasy-football-style live drafting platform that replaces the manual
spreadsheet workflow used by MBFD to assign shifts each year.

- 🔴 PIN-gated, employee-portal-authenticated
- 📱 Mobile-first, accessible (WCAG AA)
- 🎯 Live multi-user via Cloudflare Durable Objects
- 🤖 AI advisory (Anthropic Claude via Cloudflare AI Gateway)
- 🗂️ Hash-chained immutable audit log
- 🛰️ Action-card write-back to the existing MBFD Employee Portal

## Documentation

The architecture, specification, and implementation plans live in the
companion `MBFD_Hub` repository:

- **Spec**: `docs/superpowers/specs/2026-05-17-mbfd-bid-webapp-design.md`
- **Master plan**: `docs/superpowers/plans/2026-05-17-mbfd-bid-master-index.md`
- **Plan 01 (Foundation)**: `docs/superpowers/plans/2026-05-17-mbfd-bid-plan-01-foundation.md`
- **Design system**: `MBFD_Hub/.impeccable.md`
- **2026 bid materials**: `D:/MBFD/Bid/2026 Bid Documents/`

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15 App Router · React 19 · TypeScript (strict) · TailwindCSS · shadcn/ui · Zustand · TanStack Query · Framer Motion |
| API | Cloudflare Workers · Hono · Drizzle ORM · Zod |
| Realtime | Cloudflare Durable Objects + WebSockets |
| Data | Cloudflare D1 (SQLite) · R2 · KV · Queues |
| AI | Cloudflare AI Gateway → Anthropic (Claude Sonnet 4.6 + Opus 4.7) |
| Auth | Employee Portal SSO (`/verify-credentials`) + JWT (HS256, 8h) + PIN gate |
| Testing | Vitest · Playwright · Miniflare |
| CI/CD | GitHub Actions · Wrangler · `@opennextjs/cloudflare` |
| Lint/Format | Biome |

## Quickstart

```bash
pnpm install
pnpm dev          # web (3000) + worker (8787) in parallel
pnpm test         # unit + integration
pnpm test:e2e     # Playwright
pnpm lint         # Biome
pnpm typecheck
```

Open http://localhost:3000. PIN is `2300` (configurable via `PIN_HASH` Wrangler secret on deployed envs).

## Layout

```
mbfd-bid/
├── apps/
│   ├── web/        Next.js 15 frontend (Cloudflare Pages)
│   └── worker/     Hono API + BidSession Durable Object
├── packages/
│   ├── shared/     Zod schemas, types, design tokens
│   └── eligibility/  Deterministic rules + points engine (Plan 03)
└── docs/           Repo-local architecture notes + runbooks
```

## Deploy

- Pushes to `main` → automatic staging deploy via `.github/workflows/deploy-staging.yml`
- Production deploys are manual via `workflow_dispatch` on `deploy-production.yml`

## Security

- Never commit secrets. See [`SECURITY.md`](SECURITY.md).
- All Cloudflare secrets via `wrangler secret put NAME --env <env>`.
- All CI secrets via repository secrets in GitHub Actions settings.
- `.env.example` lists required names with placeholder values.

## License

Proprietary © Miami Beach Fire Department. All rights reserved.
Internal use only. Distribution prohibited without written consent.
