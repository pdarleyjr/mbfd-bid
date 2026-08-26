# MBFD Bid v2 workstream ownership

| Workstream | Owner | Write boundary | Current state |
| --- | --- | --- | --- |
| Architecture, cross-workstream decisions, and release gate | Principal agent | Centralized | Active |
| Repository and UX audit | Read-only audit lane | No writes | Complete |
| Policy/source reconciliation | Read-only audit lane | No writes | Complete; blockers recorded |
| Cloudflare/GitHub/security audit | Read-only audit lane | No cloud writes | Complete; GitHub privacy remediation performed centrally |
| QA baseline diagnosis | Read-only audit lane | No writes | In progress |
| Documentation/baseline contract | Principal agent | `docs/bid-v2/` only | Active |
| Product code | Future isolated lane | Tests first; assigned paths only | Not started |

No parallel writer may edit shared Worker routing, schema, session state, or release configuration without centralized review and a declared file boundary.
