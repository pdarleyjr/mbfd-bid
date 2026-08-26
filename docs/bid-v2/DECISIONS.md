# MBFD Bid v2 decisions

| ID | Decision | Rationale | Status |
| --- | --- | --- | --- |
| DEC-001 | Work on `feat/mbfd-bid-v2`, never directly on `main`. | Existing `main` push automation can deploy staging and apply migrations. | Adopted |
| DEC-002 | Make the repository private. | The directive treats a public personnel/certification repository as a critical privacy gate. | Implemented and verified |
| DEC-003 | Treat Media Control and all shared/unknown infrastructure as immutable. | Active operational system on a shared host. | Adopted |
| DEC-004 | Preserve unresolved policy as explicit blockers/configuration gaps. | Deterministic behavior cannot be guessed. | Adopted |
| DEC-005 | Keep AI optional, non-mutating, and absent from the initial implementation slice. | Current source retired AI; reliability and policy correctness take priority. | Adopted |
| DEC-006 | Fix reconnect correctness before adding feature surface. | A false pending pick violates canonical-live-mutation guarantees. | Proposed first code slice |
| DEC-007 | Do not deploy from the current production manifest. | Production binding placeholders and topology/CI gates are unresolved. | Adopted |
| DEC-008 | Apply supported non-major Hono, Next, NanoID, PostCSS, and ws security updates on the isolated branch. | Live audit reduced 31 findings to 5 without broadening into unsupported transitive changes. | Implemented; final verification pending |
| DEC-009 | Repair the D1 backup temporary-directory preflight locally before any backup invocation. | All observed backup workflow failures occurred before a Cloudflare call because runner `TEMP` was unset. | Implemented locally; live backup/restore remains blocked |
