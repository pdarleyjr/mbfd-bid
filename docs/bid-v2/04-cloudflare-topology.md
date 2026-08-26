# MBFD Bid v2 Cloudflare topology

## Observed dedicated-looking resources

Read-only authenticated inspection found a Bid-related Worker and Pages project. The Worker exposes bindings for one D1 database, one Durable Object namespace, one KV namespace, one Queue, two R2 buckets, and Browser Rendering. Exact IDs, secret names, and non-Bid account resources are intentionally omitted.

## Ownership classification

| Classification | Status | Rule |
| --- | --- | --- |
| BID | Candidate Worker/Pages/bound resources | Confirm by current binding and deployment evidence before mutation. |
| MEDIA_CONTROL | Media Control cloud routes/tunnels/pages/workers | `DO_NOT_TOUCH = TRUE`. |
| SHARED | Account, zone, generic tunnel/Access resources | No change until blast radius is proven. |
| UNKNOWN | Any unmatched route, DNS, Access, tunnel, or resource | Treat as non-mutable. |

## Audit findings

- Staging Worker health and the staging web origin returned HTTP 200 during passive checks. The intended production API/web hostnames did not resolve; this is a routing investigation, not authorization to edit DNS.
- No Bid-named Access application or tunnel ingress was found by name/hostname match. Naming alone is not ownership evidence.
- Production configuration in the repository contains placeholder D1/KV values. It cannot be treated as a production deployment manifest.

## Mutation gate

Before any Bid cloud change, record current Worker version, Pages deployment, route/domain, D1 schema and bookmark/backup status, binding ownership, rollback reference, and Media Control precheck where shared infrastructure could be involved. Never modify a shared tunnel, DNS record, Access application, or unknown resource for Bid convenience.
