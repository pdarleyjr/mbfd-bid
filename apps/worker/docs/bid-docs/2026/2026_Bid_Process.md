# MBFD 2026 Bid — Process Specification

> Captures the **operational flow** of the 2026 bid: who bids when, what they
> select, how ties resolve, how the admin pauses/resumes/forces, and what gets
> persisted to the audit trail.

---

## 1. Bid Cycle Overview

```
Phase 0 — Pre-Bid Preparation
  ├─ Generate Credentials DB (Active members, Active+Expired certs)
  ├─ Generate DE bid list
  ├─ Confirm 2026 Position Template (see 2026_Position_Template.md)
  ├─ Confirm 2026 Rules & Points (see 2026_Rules_and_Points.md)
  ├─ Calculate per-member point totals for each eligible position
  ├─ Mark Excluded members (Fire Chief / Deputies / Union President / probationary)
  └─ Generate the Bid Order (two pools: OFC, then FF, each by RscSeniorityIn)

Phase 1 — Officer Pool (OFC) bids
  ├─ Division Chiefs (3 picks across A/B/C)
  ├─ D-Shift Captains (4 picks: D101 Prevention, D102 SpEv, D201 EMS, D301 Support Svcs)
  ├─ D-Shift Lieutenants (4 picks: D103 PubEd, D104 SpEv, D401/D402 Training)
  ├─ 24-Shift Captains (15 picks: 4 station Captains × 3 shifts + Captain 5 × 3)
  ├─ Float Captains (3 picks across A/B/C — XX213, marine-capable)
  ├─ Union President (1 pick — A711, "Exclude" flag on count)
  └─ 24-Shift Lieutenants (37 picks across A/B/C/Rescue Float)

Phase 2 — Firefighter Pool (FF) bids
  ├─ Specialty FFs first within seniority:
  │    ├─ Air Tech (XX203 × 3)
  │    ├─ Investigator (XX303 × 3)
  │    ├─ Station 6 Fire Boat Operator (XX611 × 3) — marine-required
  │    ├─ Station 6 Marine FF (XX612 × 3) — marine-required
  │    ├─ Station 6 Post St.6 (XX613 × 3) — marine-required
  │    └─ Station 2 Special Ops FF (XX206, XX216 × 3)
  ├─ DE-qualified FFs: XX102, XX106, XX202, XX302, XX306, XX402, XX115, XX312 (8 per shift × 3)
  ├─ Rescue track FFs (Paramedic-required)
  ├─ Combat track FFs (general pop)
  └─ Float FFs (most junior fills the Float pool)

Phase 3 — R-Day (A-Day) Selection
  └─ Configured per admin preference; see §5 below.

Phase 4 — Post-Bid Finalization
  ├─ Validate every slot filled (except known vacancies XX215)
  ├─ Validate A-Day groups (5 Officers per group; 18-19 members per group)
  ├─ Generate roster PDFs per shift
  ├─ Generate A-Day group PDFs per shift
  └─ Publish to Personnel & Payroll
```

## 2. Two Bid Pools — Sort Keys

| Pool | Members | Sort Key |
|------|---------|----------|
| **OFC** | DC + Captain + Lieutenant | `RscSeniorityIn` ascending (1 = most senior dept-wide) |
| **FF** | All Firefighters (incl. DE, AT, INV, Marine, FBO) | `RscSeniorityIn` ascending within FF range |

Equal seniority resolves to **Rank Seniority** (date of promotion to current rank).

## 3. Eligibility Decision Tree (per pick)

```
for member m in bid_order:
    if m.excluded:
        skip  (member is in the Tables sheet)
    available = []
    for position p in remaining_positions:
        if p.rank ≠ m.rank:                          # rank match (or down-rank rule)
            continue
        if p.shift not in m.allowed_shifts:           # admin-controlled per session
            continue
        if not rules[p].required_satisfied_by(m):    # required certs gate
            continue
        # Eligible. Compute display priority via points.
        score = rules[p].points_total(m)
        so    = rules[p].so_points(m)
        mo    = rules[p].mo_points(m)
        available.append({p, score, so, mo})
    if not available:
        FORCED — admin intervention triggers (see §6)
    m presents preference; system validates choice ∈ available.
    Locked: position p ← m, with R-Day pick from §5.
```

## 4. Tie-Break Order (when 2+ members would qualify)

Note: in a sequential serial-dictatorship bid, ties don't actually require
break — the more-senior member arrives at the position first. But for
**recommendation/scoring** during the bid (e.g., AI advisory: "you should
prefer position X over Y because…"), the tie-break chain is:

```
1. Required Criteria satisfied?       → if not, "shows up LAST on the list"
2. Total Points (descending)
3. SO Points (descending)             — for SO-flagged positions only
4. MO Points (descending)             — for MO-flagged positions only
5. RscSeniorityIn (ascending)         — dept seniority
6. Rank Seniority (ascending)         — promotion date in current rank
```

## 5. R-Day Selection

R-Day = the day the member is off in the rotation.

### For A/B/C 24-shift positions
- 4 R-Day Groups: G1, G2, G3, G4
- Each group has fixed capacity (~18–19 members)
- Each group must have **exactly 5 Officers**

### For D-shift positions
- Pick day of the week (Mon, Wed, Fri are typical)
- Historical distribution: Fri 5, Wed 2, Mon 1

### Admin-configurable R-Day flow (see §7)
```
Option A — Concurrent: member picks (position, R-Day) in one transaction
Option B — Sequential: member picks position first; R-Day bid runs as
           Phase 3 in shift-by-shift seniority order
```

## 6. Forced Assignment / Reverse-Seniority Mechanism

Triggered when:
- A specialty position has fewer remaining qualified bidders than open slots.
- Statistical analysis shows the **last N qualified members** are unlikely to
  voluntarily pick the position.
- Mandatory minimums (e.g., need at least 1 Paramedic per Rescue per shift)
  would be violated.

Admin workflow:
1. Pause the bid (Phase 1 or 2).
2. AI advisory enumerates affected positions + candidate members.
3. Admin selects member(s) and target position(s).
4. System records `forced = true, admin_user = …, reason = …` in the audit log.
5. System marks affected members `bid_completed = true` so they're skipped on
   their natural turn.
6. Resume bid. Natural seniority order continues from next un-bid member.

## 7. Admin-Controlled Configuration Surface

These are the **knobs** the admin can set before / during the bid:

| Knob | Default | Notes |
|------|---------|-------|
| `r_day_mode` | sequential | concurrent ⎮ sequential (per 2026 lock-in) |
| `turn_timer_seconds` | **180 (3 min)** | per-pick timeout; admin-adjustable pre-bid AND live during the bid |
| `bidder_unreachable_action` | pause-first | On timer expiry: admin sees banner with PAUSE (default) or FORCE-PICK (allowed only after 2× timer = 360s by default) |
| `allowed_shifts` | A,B,C,D | can restrict per-member |
| `position_locks` | { } | pre-bid lock: position p ← member m |
| `cert_overrides` | { } | grant/revoke a cert for one member without DB write |
| `rule_overrides` | { } | runtime mutation of points/required-criteria |
| `pool_order` | OFC, FF | re-orderable in extreme cases |
| `exclusion_list` | from Tables sheet | toggleable per-member |
| `pause_state` | running | running ⎮ paused ⎮ day-paused ⎮ stopped |
| `expected_duration_days` | 2 | typical 1–3 days; AI uses for forecast pacing |

## 8. Audit Trail

Every state-changing event is logged immutably:

```
event_id (uuid), timestamp, actor (member|admin), action_type, target,
  before_state (json), after_state (json), reason (text, optional),
  ai_recommendation (json, if applicable)
```

`action_type` enum: `pick`, `forced_pick`, `pause`, `resume`, `skip`,
`override_rule`, `override_cert`, `lock_position`, `unlock_position`,
`grant_extension`, `admin_bid_for_member`.

## 9. Output Artifacts (2026 = same shape as 2025 + AI session log)

- `2026_A_Shift.pdf`, `2026_B_Shift.pdf`, `2026_C_Shift.pdf` — final roster
- `2026_A_Shift_ADays.pdf`, etc. — final A-Day group
- `2026_D_Shift.pdf` + `2026_D_Shift_RDays.pdf`
- `2026_DE_LIST.pdf` — DE-qualified bid order
- `2026_Bid_Audit_Log.csv` — full event trail
- `2026_AI_Advisory_Log.jsonl` — every AI recommendation issued during the bid (new for 2026)
