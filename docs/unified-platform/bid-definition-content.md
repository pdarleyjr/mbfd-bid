# Bid definition content and source capture

This is the first backend foundation of Phase 4. It establishes one complete,
typed representation of existing Bid material and its deterministic content hash.
It does not yet expose Save, create historical versions, adopt a year, change a
run, or provide a new editing workspace. Those operations require the atomic
version store and run pinning described below before they can be released.

## Material and authority

`BidDefinitionContentSchema` reuses the existing configuration, policy, position,
profile and participation schemas. The Worker validates rule JSON with
`decodePositionRule`; it does not introduce a second rule language. Persisted
rule rows retain their required criteria, scoring, priority chain and notes.
The capture reads all rule/participation rows belonging to the designated book
before validating their target/template identities, so orphaned, duplicated or
foreign material cannot disappear in a join.

| Definition material | Existing source |
| --- | --- |
| Settings, dates and policy | Designated `bid_years` configuration and its annual policy document |
| Opportunities and topology | Full designated position template, including division, vacancy/floating flags and legacy count exclusion |
| Final deterministic rules | Every designated book rule, decoded by the existing authority |
| Participation and staffing mapping | Explicit participation source references and staffing binding/review evidence |
| Authoring | Latest recorded profile input, compiled rules/provenance and its recorded reconciliation association |
| Source language and decisions | Policy text, annual plan source context, and latest source decision per issue |
| Notes | Bid, template and individual rule notes |

No Department member list, current qualification evidence, assignment ledger,
baseline acceptance, operator facts or capture clock enters the definition hash.
Those remain run/evaluation context. Explicit member IDs chosen in stage or
authority policy are definition inputs; they are distinct from current facts
about those people.

Final rules and compiled profile history are independent material. Capture never
invokes the compiler to replace direct rules. The original profile revision,
associated rule revision and recorded reconciliation state remain explicit;
minting a new backing book later cannot establish fresh profile reconciliation.
An absent participation row stays absent. It is distinguishable from an explicit
sourced BIDDABLE declaration even when the existing evaluator gives both the
same current participation behavior.

## Hash and normalization

`canonicalBidDefinition` uses the existing canonical JSON serializer and SHA-256.
Object keys and proven row sets receive deterministic ordering. Opportunity,
rule, participation, binding and source-decision rows sort by stable identity.
Profiles sort by ID, matching the existing compiler's keyed selection. Policy
stages sort by their explicit numeric order; member/opportunity sets, action
grants, actor sets and disposition rows normalize in both settings and document
copies before checking their parity.

Scoring group/item order, priority chains, requirement/explanation order, source
text and specialty sequences are preserved. In particular, changing the order
of capped scoring items may change itemization even when the total score agrees.
No broad text cleanup or deep array sort is performed. Internal aliases, minted
document IDs, revision counters, actors and timestamps are recorded as capture
origin instead of being mixed into the content hash.

Unknown fields/primitives, contradictory rules, duplicate identities, foreign
templates, absent targets and document/settings disagreement return structured
issues. An incomplete draft may have null settings or missing rules; its coverage
reports those omissions without inventing defaults or eligibility. A declared
template lets the existing coverage validator report every missing rule even
before the first rule exists. Legacy callers retain their original inference.

## Shared reference validation

Definition previews and existing annual-policy validation share the same
reference/order checks. The new definition context inspects real opportunity
material and configured stages. It deliberately has no Department population.
The existing run wrapper always retains member population/rank, actor, credential
catalog and specialty-evidence checks. A valid definition is therefore not a
claim of run readiness, operator authority or approved policy.

## Read consistency and provenance

`captureBidDefinitionSource` is a read-only adapter over the currently designated
legacy year. It captures and rechecks the global source revision as well as the
configuration, book/template notes, document payload, plan source and selected
profile payload. This also covers scalar sources which lack a global revision
trigger. Concurrent source changes return `bid_definition_source_changed`.

The response records source aliases/revisions and the exact byte hash of a
selected historical source snapshot when present. A missing selected snapshot
remains unavailable provenance. A byte hash does not establish verified official
completion; existing completion and Live-readiness authorities retain that gate.
An already versioned Bid must later load its own immutable bundle, never this
mutable-year adapter.

## Characterization and tests

Pure tests cover canonical identity, ordered score/priority changes, policy-set
no-ops, references, topology, malformed input and incomplete-draft coverage.
Integration tests use disposable SQLite databases with foreign keys enabled,
actual migrations and exact database-byte comparisons. They cover source drift,
advanced rule preservation, profile provenance, document parity, missing/foreign
references and explicitly unconfigured years.

All 50 committed 2026 seed rule rows are checked against the existing decoder.
The 47 accepted rows preserve their decoded material and evaluation outputs
after canonical materialization. A211, B211 and C211 already contain the
unsupported `pre_bid_pool` condition; they remain rejected with
`unsupported_custom`. No rule was changed to make a fixture pass. This is
executable characterization, not an approved historical-policy replay.

## Next transaction and retirement boundary

The version store must atomically create immutable content and isolated backing
material, append a version, compare-and-swap the current pointer and persist an
exact idempotency receipt. Ordinary semantic no-ops create no new version;
restore creates a new identity. Version-owned material needs replacement-aware
SQL seals. New runs need complete version/content/snapshot/context pins, checked
before canonical mutation and Durable Object recovery. Existing historical
snapshot bytes must remain unchanged and must not gain inferred origin claims.

The existing configuration and execution paths remain authoritative until that
integration passes its invariants. No migration, live authority, production
write, source approval, or legacy-page retirement is part of this foundation.
