# MBFD Bid v2 functional contract

## Product boundary

MBFD Bid v2 is an administrator-operated, deterministic annual Bid and specialty-adjudication platform. It is not a generic scheduling tool and it must remain useful while all optional AI capability is unavailable.

## Non-negotiable behavior

- A canonical server-side command is the only way to mutate a live session.
- Policy, eligibility, scores, ranking, constraints, awards, and effective-dated assignments must be deterministic, explainable, versioned, and auditable.
- A staffing slot, a current assignment, and a bid opportunity are distinct concepts.
- Current occupancy does not establish authorized capacity; absence from a staffing export does not establish a vacancy.
- Public/watch projections must be privacy-minimized and server-side blankable before a public route is introduced.
- User interfaces must not report a pick as pending or accepted unless it entered the canonical mutation path.
- AI may explain approved deterministic results only. It must not decide or mutate live Bid state.

## Target lifecycle (not accepted as current behavior)

1. Import and reconcile staffing, credentials, and policy sources into reviewed drafts.
2. Configure opportunities and constraints from a versioned policy.
3. Freeze approved input snapshots and validate readiness.
4. Run an isolated mock or an administrator-supervised live session.
5. Award, review, explicitly publish future assignment transitions, export, and archive.
6. Handle mid-cycle vacancies through a separate effective-dated workflow.

Steps 3–5 require immutable input and policy snapshots plus canonical
command-and-audit evidence. Neither is established by the current direct-D1
or HTTP implementation.

## Current safe implementation priorities

1. Repair the client reconnect contract so a disconnected pick cannot become a false pending submission.
2. Expose a read-only readiness view before expanding start controls.
3. Replace stale AI copy and restore small-screen admin navigation without changing Worker infrastructure.
4. Add synthetic, source-provenance tests before extending deterministic policy behavior.

## Deliberately deferred

- Any live policy interpretation blocked in [POLICY_CONFLICT_REGISTER.md](POLICY_CONFLICT_REGISTER.md).
- Public watch, portal mutation, TeleStaff output, cloud deployment, and server AI broker work until their privacy, ownership, and rollback contracts are reviewed.
