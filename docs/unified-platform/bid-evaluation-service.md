# Current Bid API and shared draft evaluation

This candidate extends immutable Bid version storage with an administrator API,
guarded Mock creation and read-only unsaved impact. The editing UI is a following
slice. No production adoption is authorized by this document: managed Live
publication, complete results/history, normative 2026 parity and release gates
remain unfinished.

## Save and run boundaries

`/api/admin/bid/:year` provides private/no-store Current Bid and paginated version
reads, structural/impact/Mock previews, semantic Save, restore and explicit pinned
Mock creation. POST requires fresh step-up; mutations also require an idempotency
key. Concrete route middleware preserves the existing canonical freeze command.
Responses expose product fields rather than SQL guards, raw snapshots or aliases.

Once a year has a Current Bid head, legacy authoring and session creation reject
competing writes both before preparation and in the transaction. Existing pinned
run commands and historical reads retain their original authority. Mock creation
atomically stores session, snapshot, audit and receipt under version/context/source
guards. Receipt replay verifies the original mode, year and four pins even after
the run progresses. It does not start or complete that run.

Migration 0062 closes configuration/annual receipt rowid and key replacement paths
without backfilling or changing existing receipt bytes. A resolved source decision
must satisfy the established title/question/decision/reference bounds. OPEN drafts
remain saveable but block preparation. Admission checks do not rewrite canonical
historical content or its hashes.

## Shared evaluation and traces

`BidEvaluationSchema` extracts existing V3 material and pool refinements without
claiming a session, saved revision or publication identity. The persisted adapter
retains complete snapshot validation and original JSON property order. One raw
Department capture supplies both saved and proposed definitions, with their own
authored dates, participation, bindings, source decisions and credential references.
The original preparation and eligibility algorithms perform both calculations.

The comparison hash binds mode, both canonical content hashes and both evaluated
context hashes. Head/source checks bracket capture and calculation. Follow-on
pages and traces must match the same comparison; stale data returns a conflict.
No version, session, audit, receipt, outbox or Durable Object is written.

Eligibility changes stream through the existing controlled policy/evidence
comparison. The response retains 100 changed rows, actual totals, unique affected
members and per-opportunity summaries instead of the complete changed matrix.
Every subsequent page recalculates and checks context. Stage-order, participation,
applicability and specialty-ranking changes come from existing policy services.
Unavailable subsections are explicitly excluded from known affected counts;
added/removed opportunities are incomparable rather than zero-score inputs.

Decision traces collect actual eligibility gates, all three score channels and
the existing comparator's steps through its first decisive result. Exact ties
remain ties. Legacy total item awards remain before the overall cap; configured
groups retain their cap behavior. Evidence and post-award obligations remain
distinct from initial eligibility. No parallel browser or explanation engine is
introduced.

## Remaining scope

Selection-dependent A-Day capacity, next bidder, interruptions and awards require
an explicit scenario and are not predicted by this comparison. Stage applicability
output still grows with member/opportunity relationships. Malformed captured
evaluation data can produce a generic failure rather than a typed blocked side.
Managed Live publication and full configuration/2026 parity remain required before
production adoption. Synthetic tests and browser fixtures do not establish live
deployment or human acceptance.
