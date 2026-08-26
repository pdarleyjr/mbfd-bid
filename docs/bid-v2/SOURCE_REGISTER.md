# MBFD Bid v2 source register

| Source | Classification | Authority | Status / rule |
| --- | --- | --- | --- |
| 2026 Bid policy documents | Policy | Primary for approved 2026 rules, subject to explicit gaps | Three vendored copies matched the external copies; companion delta requires reconciliation. |
| 2025 policy/spreadsheets | Historical evidence | Historical only | Do not use as unreviewed 2026 policy. |
| TeleStaff-style personnel export candidate | Current staffing candidate | Requires provenance/date/completeness review | Contains likely PII; do not commit or emit. |
| Repository fixtures and seed | Implementation input | Test/configuration evidence only | Not approval of live capacity, rules, or identifiers. |
| Worker/D1/Cloudflare inspection | Deployment topology | Current only after authenticated read | IDs/secrets omitted; recheck before mutation. |
| GMKtec passive inspection | Host/Media Control boundary | Current only after read | No host state was changed. |

## Source rules

1. Policy authority is contextual, not global.
2. Spreadsheets reconcile an approved policy; they do not silently override it.
3. Every consequential rule must trace to source/version/evaluation date or remain blocked.
4. Repository data must remain synthetic/sanitized until privacy and source acceptance are explicit.
