# MBFD Annual Bid UI modernization

## Source and scope

Starting checkout: `feat/mbfd-bid-v2`, `1b1ba521533089078b3f45bf607d1264c2898cb6`, with unrelated untracked browser/auth diagnostics preserved. Fetched `origin/main`: `a04d30fa6e3d97602c85a21eb681a462cc516894`; tree `f34a78464e15b574d204a2d0616aad459133d0b1`. Isolated implementation branch: `codex/shadcn-enterprise-modernization-20260907`. PR #104 is the relevant annual preparation/configuration baseline; #100–103 preserve publication and implicit-live selection fixes. No AGENTS.md was found in the repository or applicable parent directories. README, CONTRIBUTING, local .impeccable.md, architecture, annual controlled release, integration matrix and all CI workflows inform this plan. Historical documentation is subordinate to current source.

## Architecture and preservation

The existing pnpm monorepo remains intact: Next 15.5.24 / React 19.2.6 web, Hono Cloudflare Worker, shared Zod contracts, deterministic eligibility and A-Day packages. Admin layout and server pages retain requireAdmin/requirePin, server Worker fetch and RPC. Client fetches retain same-origin admin proxy, CSRF boundary, step-up handler, retained mutations, idempotency keys and query refresh. Hub federation, JWT/cookies, WebSocket ticket handling and Zustand live state are unchanged. Worker/D1/R2/KV/Durable Object/Queue bindings, migrations, exports, audit and disabled portal writeback remain unchanged.

## Visual references

All eight supplied/local references were inspected. Generated Dashboard/Board references establish matte canvas, navy navigation, restrained red actions, thin gold accents and compact rows. Their dates, people, metrics and station counts are not application data. Original A/B/C sheets establish station/apparatus hierarchy, dense rows and green/blue/red shift identity. Existing dashboard_homepage and bid_board screenshots show the actual dark baseline and excessively tall Board tiles. Preserve originals; screenshots remain ignored local artifacts.

## Installation, primitive base and Tailwind

Configure shadcn in existing `apps/web/components.json`, aliases to app-local `components/ui` and `lib/utils`. Do not scaffold or add an extra workspace. Audit found Slot only, with no active Radix primitive usage. Evaluate Base UI for new interactive primitives; use one canonical base with native shadcn form/table compositions. Research decision/source register accompanies implementation. Retain Tailwind 3.4.19 and tailwind-merge 2.5.4: existing custom tokens, installed font assets, shared package exports and OpenNext build are already compatible. Tailwind 4 and the newest cn package require separate migration; neither is necessary for this presentation task.

## Design tokens

Extend shared MBFD tokens with semantic background/foreground/card/muted/border/input/ring/primary/destructive/success/warning/info, navy sidebar, station header and shift identities. Tailwind consumes shared values through CSS custom properties injected centrally; no second independent palette. Retain self-hosted Plus Jakarta Sans, Source Sans 3 and JetBrains Mono; correct font family aliases if needed. Radius vocabulary 6/8/12px, compact table rows, 44px form/action targets, visible blue focus, reduced-motion gate. Light status surfaces use dark semantic text and explicit state words.

## Inventory and migration matrix

`plans/2026-09-07-ui-inventory.md` enumerates all route and component surfaces from the exact baseline, including boundaries, imports/dependencies, form/table/dialog counts, state markers and responsive evidence. Migration decisions: KEEP all domain handlers, schemas and lifecycle editors; WRAP native controls/tables in canonical primitives; REFACTOR AdminLayoutShell/AdminSideNav, Dashboard, BoardSeats and DataTable; REPLACE nonmodal dialog presentation with focus-managed canonical dialogs. Keep native details for server-rendered progressive disclosure and native date/select for form submission compatibility. No dead-code deletion without proven non-use.

## Implementation sequence

1. Record baseline lint, package build, protected Dashboard/Board screenshots at 390/820/1440 and safe annual/live browser fixtures. Baseline browser result: Board, read-only presentation and blocking annual policy pass; specialty resume test fails before edits because expected Original bidder content is absent. Diagnose fixture mismatch separately without weakening checks.
2. Add existing-project shadcn configuration, semantic tokens and used primitives only: Button, Input, Textarea, NativeSelect, Checkbox/Radio native adapters, Label, Card, Badge, Alert, Table, Skeleton, Separator; interactive Dialog/Sheet, Tabs/segmented navigation and Collapsible where used.
3. Refine navy collapsible desktop sidebar and account header; mobile offcanvas must preserve unsaved-navigation rejection, escape, initial focus, return focus, scroll and active nested links. Keep localStorage preference and server claim ownership. Omit fake global search/notifications.
4. Dashboard: two meaningful primary panels and control-area links with consistent icon/badge hierarchy and truthful existing descriptions. Real account name only. Make individual Board view links functional.
5. Board: preserve query selection/caching/polling/frozen source semantics and union variants. Group stations dynamically, then apparatus, with compact position/assignment rows and counts derived only from returned seats. Preserve every temporary overlay, mapping warning, participation state, historical A-Day and assignment origin. Add local member/position/station search and accessible expansion for long groups; never infer GR metadata or combat counts absent from contracts.
6. Migrate all admin workflows in inventory to semantic light surfaces and shared form/table primitives without moving Server Components to client. Retain specialized editors and existing forms, validation and disabled states. Keep native table semantics and TanStack sorting.
7. Standardize six confirmation overlays with focus trapping, accessible labels, escape and safe cancellation. Retain async pending/error state and server publication/force-pick/freeze calls.
8. Standardize PIN/login/lobby, member Bid and public presentation using the same tokens/control vocabulary while preserving room-distance sizing, readonly boundaries and print layouts.
9. Consolidate obsolete presentational class vocabulary, visually review states and all route families. No broad CSS overrides masking old dark styles.
10. Validate complete source and runtime matrix, review final diff, record dependencies, open PR and check hosted gates. Use existing deployment automation only if all required gates are available and pass.

## Acceptance matrix

| Boundary | Before/after evidence |
| --- | --- |
| Auth/PIN/Hub/logout/admin roles/CSRF | Existing web unit tests; isolated browser cookies only; real federation remains a separate staging gate |
| Configuration/policy/personnel/credentials | Existing domain tests plus local browser fixture interactions; preserve payloads and retained failures |
| Previous/current/upcoming Board | Existing independent-source browser test, filtering, selection, refresh failure retaining last success |
| Live/mock/eligibility/awards | Full Worker/shared/eligibility/A-Day tests; safe isolated browser workflows; never run a real award for visual acceptance |
| Audit/exports/print | Existing tests, unchanged API/source/bindings and explicit print review |
| Responsive | 390, 820, 1024, 1440 and wide desktop: no shell overflow; compact rows; controls reachable |
| Accessibility | Keyboard/focus/escape/trap/return focus, accessible labels, semantic tables, explicit status, contrast, reduced motion and touch geometry |
| Build/dependencies | Frozen install, Biome, typecheck, all tests, Next build, Linux OpenNext build, dependency audit, diff check |
| Deployment guards | Local backup preflight, staging/production migration-guard tests; no D1 write |

## Risk and release

Highest risks: hidden domain behavior in bespoke components, low-contrast light-theme conversions, focus/unsaved-edit changes, source mixing in Board, print regression, and Windows OpenNext parity. Mitigate with presentation-only AST-aware conversion, explicit per-file review, existing behavioral tests and equivalent screenshots. Baseline failures require evidence and diagnosis, never suppression. Preserve route contracts, identifiers, all protected data and external state.

Release through PR/CI then existing guarded staging and production workflows. Hosted CodeQL, protected secrets and deployment jobs cannot be claimed as locally verified. If hosted minutes or authentication gates block deployment, report source/browser acceptance separately and leave an exact reviewable commit/PR. UI needs no migration. Rollback is a source/artifact revert through existing workflow; do not restore databases for UI rollback. No infrastructure edits, direct production patching, secret rotation, migrations or shared-host operations are part of this implementation.

## Implementation outcome

Base UI 1.8.0 was selected. The shell, Dashboard, dynamic Board and all route families now share the semantic foundation. Native selects/dates and print geometry remain intentional. Implementation details, complete routes/files, test-harness corrections, optional unchanged coverage shortfalls and release evidence are in 2026-09-07-shadcn-ui-validation.md. No backend authority was moved into the UI.
