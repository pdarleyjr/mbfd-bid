# Architecture

This document describes the current Bid authentication boundary. The Hub is
the canonical authentication and authorization authority.

## What's wired today

```
┌──────────────────┐    PIN cookie    ┌──────────────────┐   authorization code
│  staging.bid.    │ ◄───────────────│  Cloudflare      │ ──────────────────►
│  mbfdhub.com     │                  │  OpenNext Worker │
│  (Next.js 15)    │ ───────────────► │  middleware      │ ◄────────────────── 
│                  │   JWT cookie     │                  │     api.staging.bid.mbfdhub.com
└──────────────────┘                  └──────────────────┘     (Hono Worker)
                                                                       │
                                                                       │ POST /api/v2/bid/auth/exchange
                                                                       ▼
                                                              www.mbfdhub.com
                                                              (Laravel Hub — verified staging bridge origin)
```

> **Current origin note:** staging authentication uses
> `https://www.mbfdhub.com`. The checked-in production configuration still
> names the known-invalid `https://portal.mbfdhub.com`; correct that value only
> as part of separately authorized production provisioning, never by copying
> staging resources or credentials.

## Cookies

| Name | Purpose | TTL | HttpOnly | SameSite |
|------|---------|-----|----------|----------|
| `mbfd_pin` | PIN gate pass | 7 days | yes | strict |
| `mbfd_bid_jwt` | Session JWT | 8 hours | yes | strict |

## Middleware chain (Web application)

1. `/_next/static/*`, `/_next/image/*`, `/favicon.ico`, `/api/pin` — bypass
2. `/` and `/api/auth/session-finalize` — bypass
3. `/login` — require PIN cookie
4. Everything else — require PIN cookie AND JWT cookie

## Worker routes (Plan 01)

- `GET /api/health` — liveness probe
- `POST /api/auth/exchange` — exchanges a one-time Hub authorization code with
  the dedicated federation credential and returns a signed Bid session.
- `POST /api/auth/revalidate` — forces Hub authorization revalidation for a
  current signed Bid session; no password input is accepted.

## Web routes (Plan 01)

- `/` — PIN form (Server Component + `PinForm` client component)
- `/login` — canonical Hub-federation entry point; Bid never renders a human
  password form.
- `/lobby` — protected landing page (Server Component; verifies JWT; renders member profile cards)
- `/api/pin` — sets `mbfd_pin` cookie when PIN matches
- `/api/auth/session-finalize` — verifies a worker-issued JWT and sets `mbfd_bid_jwt` cookie

## Design system

All UI honors `.impeccable.md` (kept in the companion MBFD_Hub repo). The bid
app mirrors the rules via:

- Tailwind tokens generated from `packages/shared/src/constants/design-tokens.ts`
- `app/globals.css` enforces `prefers-reduced-motion`, `(hover: none)` 44px
  touch targets, and `tabular-nums` for all numeric data
- Typography: Plus Jakarta Sans (headings), Source Sans 3 (body), JetBrains
  Mono (IDs), self-hosted via `@fontsource-variable`
- Color: red-700 brand, slate-850 admin authority, stone-* warm neutrals only

## Known watch-items

See `docs/STATUS.md` for the running list. Highlights as of Plan 01:

- `W10`: `runtime = 'edge'` removed from `/lobby` due to Next 15.0.3 +
  React 19 RC RSC bug. Re-add when Next ≥ 15.2 or React 19 stable lands.
- `W1`: `node-linker=isolated` may break OpenNext for Cloudflare resolution.
  If `opennextjs-cloudflare build` fails, add `public-hoist-pattern[]` for
  `*next*`, `*react*` in `apps/web/.npmrc`.

## What ships in Plan 02+

- D1 schema for members, certs, positions, rules, bids, audit
- Member + cert import pipelines
- Deterministic eligibility engine
- Live bid Durable Object
- AI advisory panel
- (see master plan index in `MBFD_Hub/docs/superpowers/plans/`)
