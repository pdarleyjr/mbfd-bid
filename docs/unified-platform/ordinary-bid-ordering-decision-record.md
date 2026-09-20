# Ordinary Bid ordering: final 2026 reconciliation

## Governing semantics and approved source mapping

The final July 2026 Bid Process PDF, page8, Bid Selection Process4 and
footnote4, governs this configuration. Ordinary station stages proceed Captain,
Lieutenant, Firefighter. Firefighters use Department service seniority; other
ranks use time in grade. Specialty preference scoring is a separate comparison.

The user's September19 continuation explicitly authorizes the final calculation
workbook channels as source-certified bid ordinals:

| Final workbook channel | Bid comparison domain |
| --- | --- |
| Rank Seniority | `TIME_IN_GRADE_BID_ORDINAL` |
| Straight Seniority | `DEPARTMENT_SERVICE_BID_ORDINAL` |

This mapping is resolved. These are reviewed ordinal values, not inferred dates
or authority to overwrite personnel lifecycle data. The master roster's
`RscSeniorityIn` differs from these channels. Existing `rsc_seniority` and
`rank_seniority` remain historical fields; their labels do not establish the new
source-certified domains. No promotion or hire dates were established here.

## Evidence and execution boundary

The new domains retain their source, effective date and identity reconciliation
separately. A valid source mapping does not prove that every row matches a member
or that every required value is present. Missing identities, missing values,
duplicate values and unresolved ties block affected ordering. No employee-ID or
name tie-break may silently replace a missing authoritative ordinal.

Version2 ordering authority supplies a comparator for each stage and binds it to
a resolved annual-policy source decision. Captain/Lieutenant stages use the
time-in-grade bid ordinal; Firefighter stages use the Department-service bid
ordinal. Source-configured reverse fallback uses the explicitly authorized
reverse comparator. A missing stage or disagreement with the resolved source
blocks preparation. Historical version1 snapshots retain their original
comparator and representation.

The semantic mapping is approved; actual import reconciliation, frozen evidence
and exact configuration/runtime acceptance remain separate gates. Neither a
successful mapping nor a passing synthetic comparator test proves personnel
qualification, employment status or a completed Real Bid.
