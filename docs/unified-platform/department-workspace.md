# Department workspace

## Delivered routes and authority

| Destination | Route | Existing authority reused |
| --- | --- | --- |
| People | `/admin/department` | Effective-dated personnel, Department roster, qualification projection and immutable event history |
| Roster & organization | `/admin/department/roster` | Department staffing, personnel position commands, organization versions and reviewed links |
| Credentials | `/admin/department/credentials` | Existing credential definitions and evidence references |
| Import data | `/admin/department/import` | TeleStaff staging/reconciliation and TargetSolutions resumable import services |

The navigation groups are Today, Department, Bid and History, with Docs & Manual
and Settings. Legacy pages remain available for existing links, exports, source
review and advanced records while replacement parity is established. Current Bid
versions, Blueprint and complete legacy retirement are later integration slices;
this workspace is not a claim that the unified platform is complete.

## Read contracts

`GET /api/admin/department/people` accepts `as_of`, `q`, `employment_status`,
`page` and `page_size`. It returns complete pagination metadata and never silently
caps the department at 500 members. The UI uses 25 records per page. Searches
include employee identity, first/last name and last/first name.

`GET /api/admin/department/people/:id` returns the same dated person plus
qualification status and retained personnel, assignment and qualification
history, including recorded future changes. Both endpoints require administrator
authorization, send no-store responses and perform no writes. The shared
Department roster remains the assignment authority.

Rank, employment and assignment use their existing dated projections. Hire and
promotion dates and seniority are explicitly the **current member record**, not
fabricated historical reconstructions. Unknown rank classification, missing
evidence and unresolved qualification impact remain explicit. Current credential
display metadata overlays presentation names; immutable evidence, stable IDs and
evaluator input names remain unchanged. `updatedAtScope` is
`department_roster_sources`, because legacy credential records do not all have an
update timestamp. It must not be presented as the last change across every
qualification or service source.

The reader loads the department before filtering/paging, appropriate to the
current small department. This is not a claim of unbounded-population database
optimization. Parallel reads are not a D1 transaction; a disappearing member
record fails visibly instead of manufacturing data.

## Member changes

The person detail opens one Update member panel, with Employment or assignment
and Credential change branches. Focused modes in the existing workspaces retain
their canonical writers, idempotency keys, server previews and event receipts.
No browser eligibility reducer or separate lifecycle engine is introduced.

Personnel previews now use the same effective-dated member, cancelled-assignment
filter, correction-only supersession rules and target availability checks as
the existing commit path. Editing fields invalidates the preview. Server errors
and unavailable qualification calculations remain visible.

Add member reuses the existing NEW_HIRE command. Its first review is explicitly a
review of entered details, without a server preview or write. Confirmation submits
the command. Lost or mismatched receipts retain the same request body and key;
focused forms remain locked until the expected event is recovered. A later
authentication rejection does not establish that an earlier uncertain request
was never accepted. Confirmed receipts trigger the existing refresh helper,
expanded to include Department queries.

Dirty branch changes and panel closes require explicit discard. Busy or uncertain
forms retain their state. Browser navigation uses the existing unsaved-change
guard. A user who deliberately leaves an uncertain operation still needs its
retained server receipt before attempting a different correction.

## Retirement and organization

`POST /api/admin/personnel/changes/preview` supports POSITION_RETIRE without a
member ID. A successful read returns `{preview:true, impact}` even when blocked.
The impact names the target, requested date, inclusive last active day,
assignments and their statuses/date relationships, dated organization/link
evidence, blockers and the fact that history is retained.

Position blockers reproduce the existing active-window/occupancy prechecks and
the existing planned/active assignment authorization guard. Organization links
are contextual for position retirement, not newly invented blockers. The commit
recomputes authority before the existing atomic batch and retains the original
error-only rejection contract and idempotent lifecycle receipt. D1 guards remain
the final authority if another operation races the precheck.

Organization dependencies retain their prior keys and add the typed impact. The
existing active/future direct dependency predicates determine blockers. Dated
descendant assignments are context, not an added retirement policy. Earlier
versions and ended/cancelled assignments remain in evidence. The form requires a
successful unblocked target/date/revision preview, and organization SQL guards
still enforce the accepted revision and dependencies at submission.

Organization and position/link writers preserve request identity through an
uncertain result. Date and workspace switching lock while a local draft or
uncertain operation needs attention; explicit cancel/clear releases a known
unsubmitted draft. Roster member links retain `as_of`.

## Definitions and import

Department credential definitions hide point controls and preserve stored values
on edits. Creating a definition uses the existing zero default; this is not a
claim that zero is its approved value in any Bid. Evidence remains person-bound.

Both imports reuse existing source hashes, exact employee matching, review gates,
resumable progress and apply receipts. Source selection and TargetSolutions
import context remain in the URL. Navigation warns about unrecorded input or
pending operations. Loaded persisted review data alone does not count as an
unsaved change. Successful imports invalidate Department and existing working
projections. No writer for Real Bid execution or portal writeback changed.

## Verification boundaries

The new tests cover read-only dated people/retirement projections, existing
preview/commit parity, future assignment races, duplicate identities, credential
display overlays, draft cancellation, invalidated previews, lost-result retries,
import context and refresh, and legacy form behavior. Browser evidence uses
synthetic records and is reported separately from unit tests, hosted CI and
production acceptance. The guide and generated PDF describe these routes.

See [Department browser validation](department-validation.md) for the 18 Department
and 14 existing Today/navigation cases passed across recorded runs, reviewed
synthetic desktop/mobile captures, fixture isolation and acceptance limits.

No migration is required for this slice. No production people, assignments,
policies or Bid runs are used as test fixtures. Exact candidate commit, hosted
gates and browser captures are attached to the PR when available.
