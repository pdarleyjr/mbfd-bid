# Current Bid editing, Mock creation and unsaved impact

This implementation candidate follows the immutable content and version-storage
foundations. It is not a production release record. Live publication, integrated
run history, adaptive execution gaps and normative 2026 parity remain separate gates.

## One editing workspace

`/admin/current-bid?year=YYYY` owns one browser draft across Edit, Blueprint,
Mock, Live, Results and versions. The primary Bid navigation points here.
The old authoring routes remain compatible only for unadopted years. Once a
Current Bid head exists, legacy mutation and creation paths reject a competing
write, including a race after their initial check. Existing pinned run commands
and forensic reads retain their authority.

The editor preserves typed settings, complete opportunity/rule material,
participation, source decisions, staffing bindings and captured authoring
provenance. Field edits patch the original rule columns and preserve ordered
requirements, OR groups, capped awards, priorities, optional fields and nulls.
Missing references stay visible. A different staffing connection loses the old
pair's approval/source reference and requires explicit review. Removing grouped
specialty scoring removes both optional scoring and ranking-channel fields.

All editing remains local until an explicit save. The browser's permissive
structural draft schema is never a server validator or canonical hash authority.
It admits incomplete field entry but rejects unknown data shapes. Server Save
continues to use canonical content, expected-head/source checks, semantic no-op
suppression, immutable versions and atomic audit/receipt writes. Restore always
creates a new version. Old versions and runs are not rewritten.

## Request recovery

Draft storage is scoped by actor/security identity and year. Before a protected
write or authentication renewal, the full pending request is stored and read back.
A storage failure prevents dispatch. Pending request path, exact body and
idempotency key survive refresh, step-up and an uncertain network outcome.
Retries recover the original receipt before considering a new current head.
Acknowledged-write/failed-refresh is distinct from failed-write. The original
request remains recoverable until a valid receipt and fresh Current Bid load are
both available. No credential, token or cookie is included in the draft.

Migration 0062 preserves existing configuration and annual-plan receipt bytes
against rowid replacement, key replacement and row movement. It adds no backfill.

Unfinished source decisions may remain OPEN in a saved draft. RESOLVED decisions
must retain the existing source-review text bounds for title, question, decision
and reference. Save, restore and structural preview validate that evidence; run
preparation and impact cannot treat an incomplete resolution as approval. Raw
historical content and canonical hashes retain their original representation.

## HTTP facade

All routes under `/api/admin/bid/:year` require an authenticated administrator,
validate the existing year and return private/no-store responses. POST preview
and mutations require step-up. Mutations require an idempotency key.

| Route | Effect |
| --- | --- |
| GET `current` | Current immutable version or a consistent read-only legacy adoption source |
| GET `versions`, GET `versions/:id` | Paginated history and integrity-checked historical content |
| POST `preview`, kind `definition` | Structural validation and semantic configuration diff; no writes |
| POST `preview`, kind `impact` | Unsaved baseline/candidate calculation on one Department capture; no writes |
| POST `preview`, kind `mock` | Exact saved-version/context readiness; no writes |
| POST `versions` | Semantic Save/no-op with the existing atomic version store |
| POST `restore` | Restore selected historical content as a new immutable version |
| POST `mock-sessions` | Exact reviewed saved version/context into an isolated new Mock |

Concrete middleware paths avoid consuming the existing `/api/admin/bid/freeze`
command. Malformed JSON is rejected before framework validation. Responses
whitelist product fields and never serialize SQL guards, snapshot bodies or
private backing aliases.

## One calculation authority

`BidEvaluationSchema` extracts the existing V3 pool and material refinements into
shared functions. A neutral evaluation has no session, saved revision, publication
state or policy-document identity. The persisted snapshot adapter still validates
the complete V3 snapshot and retains its exact JSON property order and bytes.
Document/version identity checks remain at the session boundary.

`loadBidEvaluationEvidence` captures raw dated personnel, qualifications, service,
assignments, tenure, staffing baseline, catalog and unresolved import evidence.
`prepareCapturedBidEvaluation` is the original saved-run transformation, extracted
once. Baseline and candidate reuse the same capture with their respective authored
dates, staffing bindings, participation and source decisions. Candidate credential
references are tested against the captured disputes using the original SQLite
date/JSON-tree predicate; a new unsaved qualification cannot bypass its review.

The endpoint brackets the entire capture and both calculations with the existing
control token and expected head. Any intervening source/head mutation discards
the result. The comparison digest binds mode, both canonical content hashes and
both context hashes. Follow-on pages and traces require that digest; response
year, mode, source kind, trace selection and page offset are checked by the client.

Eligibility, three-channel scoring, priorities, stage order and specialty ranking
reuse their existing authorities. Comparator traces visit the same steps until
the first decisive difference; an unresolved tie remains a tie. Scoring trace
collection preserves the established eligibility result bytes and exposes all
three channels without a parallel evaluator. Legacy total item awards remain
pre-overall-cap; configured group awards retain their existing cap semantics.

## Interpretation and scale

The existing controlled impact comparison holds new evidence/cohort fixed while
changing rules, then holds prior rules fixed while changing evidence/cohort. A
participation-policy edit can change that cohort without changing Department
records. Pool, stage-order, stage-opportunity, specialty ranking, specialty
applicability and specialty behavior changes contribute unique affected members.
Added/removed opportunities are incomparable, never invented zero-score inputs.

Invalid whole-side preparation returns a blocked result with no successful
comparison hash or fabricated counts. Execution reference errors are separate
from stage ordering. An invalid specialty reference is unavailable, not an
evaluated empty candidate list. Legitimately empty evaluated lists remain empty.
Unknown subsection results are explicitly excluded from the known affected count.

The comparison streams every member/opportunity result through the existing
algorithm while retaining 100 visible change rows, totals and unique affected IDs.
Before/after opportunity summaries are collected during those same three controlled
passes. It does not retain the full changed-result matrix or cache across requests.
Each subsequent page is freshly calculated and context-checked.

The Blueprint renders a semantic stage list, per-opportunity counts, paginated
changes and server decision cards. It contains no eligibility, scoring or ranking
calculation. A-Day capacity, next-bidder selection, actual interruptions and awards
still require explicit selection context; this implementation does not invent it.

## Remaining integration

Current Bid Mock creation pins version ID, content hash, context hash and exact
snapshot hash. A guarded creation batch writes the session, snapshot, audit and
receipt together. Replay validates the original session and returns it even if
its run has progressed. Creating a Mock neither starts nor completes it.

Live and Results currently expose the existing consoles/reports. Version-bound
Live publication, complete integrated History, profile compilation editing,
source-document upload, generic stage/timing/A-Day primitives, full selection
scenarios and normative approved 2026 parity remain unfinished. No production
adoption should be released before the required run creation/publication and
release gates are integrated and independently verified.
