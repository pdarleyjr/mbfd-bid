# MBFD Bid v2 workstream ownership

| Workstream | Owner | Write boundary | Current state |
| --- | --- | --- | --- |
| Architecture, cross-workstream decisions, and release gate | Principal agent | Centralized | Active |
| Repository and UX audit | Read-only audit lane | No writes | Complete |
| Policy/source reconciliation | Read-only audit lane | No writes | Complete; blockers recorded |
| Cloudflare/GitHub/security audit | Read-only audit lane | No cloud writes | Complete; GitHub privacy remediation performed centrally |
| QA baseline diagnosis | Read-only audit lane | No writes | Complete locally; CI evidence unobserved |
| Documentation/baseline contract | Principal agent | `docs/bid-v2/` only | Phase 0 checkpointed; update with later evidence |
| Product code | Principal agent | Tests first; isolated file boundaries | Safety/readiness and Worker HTTP policy-decoding guards implemented locally; Durable Object live-policy enforcement and policy-dependent domain behavior remain blocked |

No parallel writer may edit shared Worker routing, schema, session state, or release configuration without centralized review and a declared file boundary.
