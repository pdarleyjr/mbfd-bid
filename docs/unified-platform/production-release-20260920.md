# Production release record — 2026-09-20

This sanitized record establishes the deployed software and final **authored** 2026 configuration. It does not certify an executable configuration, actual personnel eligibility, external publication or permission to start a Real Bid. The [current release status](final-2026-release-status.md) and [coverage matrix](final-2026-coverage-matrix.md) keep those boundaries explicit.

## Immutable release and runtime identity

| Field | Verified value |
| --- | --- |
| Corrective PR | [#132, merged](https://github.com/pdarleyjr/mbfd-bid/pull/132); earlier #129 also merged |
| Validated candidate | `605100104697af53098115e2abff3bd3efd0fbf5` |
| Deployed merged SHA | `85823a5da3c79f6a72684342a9f030f4ad78c84b` |
| Candidate and merged tree | `18445a878f177713ac70ffaee233ffe3f0582206`; exact parity verified |
| Production deployment | [35487527280](https://github.com/pdarleyjr/mbfd-bid/actions/runs/35487527280), succeeded with normal environment gates |
| Merged CI / CodeQL | [35487406507](https://github.com/pdarleyjr/mbfd-bid/actions/runs/35487406507) / [35487406555](https://github.com/pdarleyjr/mbfd-bid/actions/runs/35487406555), succeeded |
| Worker deployment / version | `252e2a96-1a29-4b6f-9dac-fd86d5698606` / `6c7615a5-96c0-496d-a22a-08fb77436363`; 100% traffic |
| Web deployment / version | `4235cb59-fa29-483f-8377-17de775b44b4` / `8acf7b60-197f-4f7a-971b-b0486ffee2c2`; 100% traffic |

The runtime versions match the recorded release artifacts. Worker health returned HTTP 200 with `ok: true` in production. This corrective release supersedes the first release at `bf7ca49eeaaa34d35cdc9e26ce768c9b6cc4da85`; it preserves its controlled migration history and corrects the production roster query and mobile navigation/focus defects.

## Recovery and production migrations

Canonical migrations **0059–0067 applied successfully in order**, ending at `0067_bid_evidence_insert_seals.sql`. Final checks found the exact 67-entry ledger, quick check `ok`, zero foreign-key violations, zero Real sessions and zero changes to protected historical row counts. Canonical SQL and the deployment migration guard were unchanged. There were no manual ledger inserts, resets, reseeds or production recovery tests.

Before migration, qualified backup workflow `35481944367` and a local rehearsal established preservation of all 75 original tables and 20,662 original rows/columns through the nine migrations. Migration evidence is retained privately as `migration-run-20260920T020534084Z-daf29162eaf946a2a720b0c441ec73e0`. Before the corrective deployment, fresh backup workflow `35487419007` succeeded at the exact merged SHA; the retrieved export and recovery receipt matched and imported into isolated SQLite with valid integrity, ledger and session checks. Private SQL, storage locations, recovery bookmarks and access URLs are deliberately omitted.

## Immutable configuration and ordering evidence

Normal authenticated, CSRF-protected application workflows preserved legacy v1, saved final authored v2, and imported the reviewed ordinal dataset. Exact content and ordinal-entry readbacks passed. Version history contains both versions with v2's predecessor pointing to v1; acceptance created no additional version.

| Record | Verified content |
| --- | --- |
| Legacy version 1 | 242 positions, 238 rules; SHA-256 `1167b7ace63245f4e9f8f0e79ae04b78a3176adf832a1bb281099f4044e3d760` |
| Final 2026 authored version 2 | 228 positions, 223 active rules; SHA-256 `bb9eddf57e1dac53d0ac850a0fb8c56d52bb9d8f25f2bfe54e2585aae2605b09` |
| Ordinal dataset | Revision 1; **232 exact-identity records saved and individually verified** from 233 source rows; one unresolved source row |

V2 preserves 228 source profiles, 24 homogeneous opportunity pools, 10 current fallback policies and five pending source-stage definitions. Its settings and executable policy are incomplete. **V2 is the Final 2026 Authored Configuration, not the Final 2026 Executable Configuration.** Complete authoritative execution inputs must be saved through the normal semantic Save path as the next immutable version; v2 must remain unchanged.

Configured-state acceptance at 2026-09-20T10:42:06Z observed:

| Read-only check | Actual result |
| --- | --- |
| Profile review | HTTP 200, valid, `MATERIALIZED` |
| Participant preview | HTTP 409, `stage_participant_preview_unavailable` |
| Impact comparison | HTTP 200, valid response, outcome comparison blocked by missing settings and policy; UI explains missing timing and evidence dates |
| Mock preparation | `wouldAllowCreateMock: false`; `bid_configuration_settings_invalid` |
| Managed Live preparation | `wouldAllowCreateLive: false`; `bid_configuration_live_policy_required` |

These are explicit readiness denials, not failed deployment checks. A new production Mock using a final executable configuration has **not** been completed. Three historical Mocks remain preserved and no Real session exists. The follow-up readiness inventory must use fresh server preparation output and authoritative source/Department evidence; earlier gap lists do not establish the current full blocker set.

## Validation and bounded authenticated acceptance

All final candidate gates belong to `605100104697af53098115e2abff3bd3efd0fbf5`, whose tree matches the deployed merge:

| Gate | Result |
| --- | --- |
| Ordinary tests | 3,780 passed; 21 intentional skips |
| Actual D1 / Durable Object runtime | Five passed, including two D1 regression tests and three DO tests |
| Full final-source local canonical Mock | Passed: 223 awards across 228 positions, 241 command attempts, completion, Results and read-only Department preview; zero legacy award or Department assignment writes |
| Linux staging and production OpenNext builds | Both passed |
| Complete Linux desktop/mobile browser suite | 138 passed, 18 documented skips; no failures, retries or flaky results |
| Separate large-impact browser suite | 14 passed; no skips, failures or retries |
| Exact-candidate CI / CodeQL | 35486886177 / 35486886116 passed |

The local Mock used explicitly synthetic personnel, qualifications, service and ordinal evidence, dates, operator grants, staffing bindings and unresolved operational assumptions. It proves bounded canonical execution behavior, not actual production readiness. Browser skips comprise ten executions requiring authorized storage state, four requiring controlled API/PIN and four executions of legacy stubs. Hosted Actions were available; the hosted browser job is configured to skip, so the complete browser evidence is the separately executed Linux suite.

Fresh authenticated production acceptance observed Today, Department people/roster, credentials, both import screens, Current Bid, Blueprint, profiles, pending stages, impact, versions, Mock/Live blocked-state explanations, Results, History and documentation. Mobile Board-to-Today navigation completed, and Edit Bid retained keyboard focus after a query-only transition. Selected 1280px desktop and 390px mobile checks found no document-level horizontal overflow. These checks cover observed routes and interactions; they do not certify every feature or employee.

The final configured-state network window was untruncated with no observed HTTP error responses or runtime exceptions. The explicit participant-preview HTTP 409 above remains separately recorded as an expected readiness denial. Earlier truncated event captures are not exhaustive network evidence. A profile-preview transport wait expired before its later explicit read-only response completed; it is not counted as executable-readiness proof.

The Administrator Guide contains 56 topics and one downloadable PDF. Authenticated PDF readback returned HTTP 200, `application/pdf`, a valid PDF header and 208,307 bytes. SHA-256: `b75a2fce36e8fee6811a0565e28d7c88683a894c31321a9dfe5435eeffc6a96e`. The guide describes operations and does not assert that this Bid is execution-ready; source/PDF synchronization is covered by the existing manual contract tests.

## Completed staging follow-up and current boundaries

Earlier staging runs `35481928154` and `35487406461` failed the unchanged migration guard because staging ended at 0058 while this release requires 0067. Those failures remain historical evidence. The subsequent controlled staging follow-up completed canonical migrations **0059–0067** without changing their SQL or weakening the guard. Remote quick check and foreign-key checks passed with the exact 67-entry ledger and unchanged protected table counts at every step. Before/after export comparison verified all **74 original tables, 8,746 original rows and original column values** preserved. Full integrity checks passed on the restored local exports; remote `PRAGMA integrity_check` is unsupported by D1 (`SQLITE_AUTH`) and is not reported as a remote pass. Backup bytes and recovery evidence remain private.

Staging deployment [35523541811](https://github.com/pdarleyjr/mbfd-bid/actions/runs/35523541811) **succeeded** at exact merged `85823a5da3c79f6a72684342a9f030f4ad78c84b`. Both runtime versions match their deployment artifacts at 100% traffic:

| Staging runtime | Deployment ID | Version ID |
| --- | --- | --- |
| Worker | `44c61ef7-b44e-4e9c-8ff2-eb65f9f73d67` | `e1ab0ddf-3348-47b9-a34d-301795a12016` |
| Web | `ef8e6548-9074-4d30-afca-01a90e0fcaaf` | `00462a95-240a-4956-b5eb-0933dd587a80` |

Worker health returned HTTP 200, `ok: true`, environment `staging`; Web returned HTTP 200. Browser smoke verified the staging banner, PIN gate and protected Current Bid redirect to that gate. **Authenticated staging acceptance was not executed.** Schema/application parity does not imply production data or configuration parity. This follow-up did not redeploy production.

```text
APPLICATION_DEPLOYED = YES
FINAL_2026_CONFIGURED = YES
FINAL_2026_AUTHORED_CONFIGURATION = YES
FINAL_2026_EXECUTABLE_CONFIGURATION = NO
PARTICIPANT_PREVIEW_READY = NO
PRODUCTION_MOCK_COMPLETED = NO
REAL_BID_READY = NO
REAL_BID_STARTED = NO
REAL_SELECTION_RECORDED = NO
REAL_FORCE_USED = NO
PRODUCTION_PERSONNEL_TEST_MUTATION = NO
HISTORICAL_MOCK_MUTATED = NO
PORTAL_WRITEBACK_ENABLED = NO
STAGING_SCHEMA_PARITY = YES
STAGING_APPLICATION_PARITY = YES
```

Portal writeback is disabled in the effective Worker settings and the writer binding is absent. Remaining source decisions and personnel evidence must be resolved within their affected scopes. No Real start, selection, force, production personnel testing or Mock-to-Department application is part of this readiness follow-up.

## Readiness follow-up after staging restoration

Fresh authenticated read-only production checks again returned a valid definition,
`stage_participant_preview_unavailable`, `bid_configuration_settings_invalid`
for Mock, and `bid_configuration_live_policy_required` for Live. These preparation
paths stop at the first failure; the complete follow-up inventory therefore also
uses the actual saved source decisions, schema validation and a fresh isolated
Department snapshot. Deeper inferred prerequisites are not presented as server
checks that have already run.

Seven distinct source-qualified credential catalog definitions were created via
the normal authenticated, CSRF-protected, idempotent and audited workflow. All
seven returned HTTP 201 and exact readback verified zero holders and zero catalog
default points; explicit versioned Bid scoring remains separate. The catalog now
contains 219 definitions. No member qualification was granted or equivalence
inferred. A CSRF bootstrap rate limit interrupted the first batch after four
successful creations; the remaining three completed after the normal cooldown.

All 228 source opportunities are accounted for in a private proposed binding
inventory: 122 safe existing-seat bindings, 93 proposed distinct seats awaiting
an authorized effective date and coordinated activation/supersession, eight
existing equivalent-seat allocations, two Department rank-metadata conflicts,
two final-source contradictions, and one excluded Union opportunity requiring
no binding. These counts describe reviewed proposals, not saved v2 bindings.
The 93 proposals are not a claim that 93 new seats are unavoidable; three have
conditional existing-seat aliases requiring an authoritative numbering rule.
No Department seat, assignment or occupant was created by this follow-up.

An unsaved draft carries the 122 bindings, seven source-derived resolutions and
seven catalog-identity resolutions. It also preserves the direct user decision
to use **all reviewed qualified volunteers** for SWAT. The reviewed candidate
list, training and deployability evidence are still required; the population
interpretation is no longer a human question. The typed resolved decision must
be bound to its executable membership distribution together through normal Save.
The earlier authored definition still has 44 open decisions; the private draft
has 30, including the pending SWAT evidence/configuration binding. These counts
are not counts of distinct human policy questions.

The draft also closes two unnecessary current-Bid questions: no additional powers are inferred from the absent Article 5 text, and the closed Training roles do not require current candidate evidence until a future activation. Both retain their governing policy and safety boundaries.

Normal server definition preview passed with valid coverage before the SWAT
decision was incorporated. The current draft then passed the released pure
profile compiler locally: 223 active rules, unchanged admission requirements and
ordering, with a scoring change only for the Prevention Lieutenant's two
source-supported completed-course preferences. The future Training preference
correction preserves its closed 2026 opportunities. A later production profile
preview was denied by the five-minute authorization guard; no authenticated
profile-impact result is claimed. The locally materialized content hash is
`9873e578535316d6ae39608eb0b3d97510388562172f1846737d82618acf0a32`.
This draft remains **unsaved and non-executable**; no v3 was created.

At 2026-09-20T17:02:16Z, a read-only production comparison verified exact original
row content for 20 protected personnel, staffing, configuration, ordinal and
session tables. Both saved versions, 232 ordinal entries, zero Real sessions,
three historical Mocks, qualification holdings/events and personnel assignments
were preserved. Quick check was `ok`, foreign-key violations were zero, and the
verification wrote zero rows. Portal writeback remains off.

The current whole-definition preparation guard rejects any open source decision;
there is no scoped non-SWAT/non-Marine execution preflight for this unchanged
release. Individual missing qualifications have affected-member eligibility
scope, but this follow-up does not claim unrelated whole-Bid readiness while
global source decisions remain open. No guard or policy requirement was weakened.

The [finite readiness decision packet](readiness-decisions-20260920.md) identifies
the remaining operating and source inputs. Its [sanitized inventory](readiness-gap-inventory-20260920.json)
accounts for every original open decision; exact member/cohort facts and staffing
identity mappings are retained only in the private evidence package.

## Evidence provenance

This durable summary was transcribed from the private `release-evidence-report.md` and sanitized `production-release-85823a5` records: release identity, Worker/Web runtime identity, configuration readback, configured acceptance, browser network/focus, manual readback and backup qualification. Those records are retained under the ignored release-evidence directory. The detailed captures are intentionally not tracked because they can contain personnel or operational data. Public workflow links and the immutable identities above provide the durable release trail without disclosing that data.

Staging follow-up evidence is retained separately in ignored `readiness-20260920/staging/parity-sanitized.json`, `post-migration-verification-sanitized.json` and `migration-progress-sanitized.json`. These records distinguish remote checks, local full-value preservation and the limited browser smoke from unexecuted authenticated acceptance.
