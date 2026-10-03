# Annual Bid curveball rehearsal

## Operator workflow

From Current Bid, choose **New Mock Bid**. The saved version is checked before
creation. Open the resulting session and choose **Start Mock Bid**. Existing
Mocks retain their frozen rules and picks. Real preparation uses the same saved
definition, with its separate readiness and explicit creation/start checks.

Choose a member to inspect current and previous assignments. Normal selection
uses the current authoritative turn. **Administrator override** supports another
member, an open position, skipping a member, or bypassing a stage while retaining
pending rights. Review the current advisories and supply a reason. An explicit
forced assignment receives a **FORCED** marker and recorded provenance.

When a specialty request has higher-priority candidates, the normal selection
panel offers the review automatically. It shows frozen points and ordering,
allows each candidate to choose a related eligible seat, and keeps the review
open for additional offers. **Resume original bidder** ends the review without
inventing other candidates' declines. The original bidder can choose a regular
seat. An early specialty winner remains in the queue until their ordinary A-Day
turn; the A-Day task opens when that turn becomes current.
Passing an ordinary turn without a terminal disposition does not waive
independent specialty priority or prevent a later forced/fallback assignment.

**Other bid actions → Chief-directed role** records a temporary acting duty for
an unawarded participant. It holds their ordinary bid turns, keeps their official
rank, and displays the duty separately from position awards. Release returns
pending rights without rewinding expired Days turns. It does not promote a
member or write to personnel or staffing records.

Credential coverage uses frozen eligibility for the open seats. A pool with
twice as many eligible members as remaining seats, or fewer, receives a low-buffer
warning; an actual shortfall is distinct. Matching also detects overlapping
qualification shortages and critical members. An unavailable advisory is shown
explicitly and does not erase the authoritative controls.

## Source-backed 2026 specialty configuration

The corrected source rules already contain the Station #2 Special Operations
scoring. Saved Version 14 lacked the Captain and Lieutenant interruption
catalogs. In **Specialty rules**, **Prepare Station 2 priority workflow** copies
the source scoring into three homogeneous rank families, then uses the existing
draft review and Save. It never changes a running Mock.

The shortcut checks the exact 2026 role identities, rank-only requirements,
13-point scoring groups, technician gating, certified ordinal comparators,
participation, stage membership, and conflicting specialties/timing scopes.
Modified or unknown source material requires ordinary authoring. Captain 5,
Air Tech, DE, paramedic and other distinct minima remain separate. The existing
Investigator policy is retained. Deferred A-Day timing is explicitly attributed
to the administrator's October 3 scenario and governing procedures.

## Presentation

Each session has its own presentation link. The header identifies the actual
specialty candidate or returned bidder when applicable, with rank, current seat,
prior bid and the deferred A-Day indicator. The right queue can be opened or
closed; the current bidder and on-deck member have distinct highlights. Completed
members disappear, while early specialty winners retain an A-Day due entry.

Shift arrows and tabs show A, B, C and Days. Wide screens show the complete shift;
small screens page readable station seats within the viewport. View navigation
does not mutate the bid. LIVE, HOLD, RESUME and OFF are independent of execution.
Held projections retain null fields and cannot fall through to later live state.
The authenticated response is private and not cacheable.

## Verification and release boundaries

Regression coverage includes canonical specialty awards and ordinary A-Day
turns for CPT/LT/FF, related seats, correction lineage, explicit review closure,
directed-role release, forced provenance, mixed-rank/excluded candidate pools,
10-qualified/5-seat coverage warnings, overlapping coverage matching, historical
context, and nullable HOLD projections. Browser fixtures cover all four shifts,
six sizes from 320×568 to 3840×2160, queue highlights, deferred headers, and zero
audience writes. Fixture acceptance remains distinct from an actual production
Mock rehearsal and Real Bid acceptance.

Release uses the existing immutable-SHA production workflow and recorded backup.
This change has no D1 schema migration. Source review decisions remain explicit;
Mock tests do not resolve Real-only evidence or policy approvals. A partial test
Mock must not be sealed as completed results. Portal/staffing writeback and
protected existing Mocks remain outside this rehearsal.

## Technology research

The viewport uses dynamic CSS lengths and ResizeObserver so browser chrome and
actual available space determine pagination. Controls preserve focus and usable
touch targets. Read-only audience requests cannot dispatch commands, and canonical
selection still uses sequence checks and atomic event/audit/receipt persistence.

- [WCAG reflow](https://www.w3.org/WAI/WCAG21/Understanding/reflow)
- [WAI-ARIA](https://www.w3.org/TR/wai-aria/)
- [CSS length units](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/length)
- [ResizeObserver](https://developer.mozilla.org/en-US/docs/Web/API/Resize_Observer_API)
- [Next.js data fetching](https://nextjs.org/docs/app/getting-started/fetching-data)
- [Next.js backend for frontend](https://nextjs.org/docs/app/guides/backend-for-frontend)
- [Cloudflare D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [Cloudflare Durable Objects practices](https://developers.cloudflare.com/durable-objects/best-practices/)
