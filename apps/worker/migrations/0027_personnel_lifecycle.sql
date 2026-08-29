-- MBFD Bid V2 year-round personnel lifecycle ledger.
--
-- This retains `members` as the canonical identity/current projection and
-- `member_assignments` as the effective-dated assignment history.  The new
-- ledger records why a personnel or staffing transition occurred without
-- deleting or rewriting either history.

ALTER TABLE members
  ADD COLUMN employment_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (employment_status IN ('unknown', 'active', 'inactive', 'retired', 'separated'));
--> statement-breakpoint
ALTER TABLE members
  ADD COLUMN employment_status_effective_on TEXT;
--> statement-breakpoint
ALTER TABLE members
  ADD COLUMN separation_type TEXT;
--> statement-breakpoint

CREATE TABLE personnel_lifecycle_events (
  id TEXT PRIMARY KEY NOT NULL,
  member_id INTEGER REFERENCES members(id) ON DELETE RESTRICT,
  staffing_position_id TEXT REFERENCES staffing_positions(id) ON DELETE RESTRICT,
  member_assignment_id TEXT REFERENCES member_assignments(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN (
    'NEW_HIRE',
    'REACTIVATION',
    'PROMOTION',
    'DEMOTION',
    'TRANSFER',
    'ADMIN_REASSIGNMENT',
    'RETIREMENT',
    'SEPARATION',
    'VACATE',
    'POSITION_CREATE',
    'POSITION_RETIRE',
    'CORRECTION'
  )),
  effective_on TEXT NOT NULL CHECK (
    length(effective_on) = 10
    AND strftime('%Y-%m-%d', effective_on) IS NOT NULL
    AND strftime('%Y-%m-%d', effective_on) = effective_on
  ),
  employment_status_before TEXT CHECK (
    employment_status_before IS NULL
    OR employment_status_before IN ('unknown', 'active', 'inactive', 'retired', 'separated')
  ),
  employment_status_after TEXT CHECK (
    employment_status_after IS NULL
    OR employment_status_after IN ('unknown', 'active', 'inactive', 'retired', 'separated')
  ),
  rank_before TEXT CHECK (
    rank_before IS NULL
    OR rank_before IN ('FF', 'LT', 'CPT', 'DC', 'DEP_CHIEF', 'CHIEF')
  ),
  rank_after TEXT CHECK (
    rank_after IS NULL
    OR rank_after IN ('FF', 'LT', 'CPT', 'DC', 'DEP_CHIEF', 'CHIEF')
  ),
  separation_type TEXT,
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  origin TEXT NOT NULL CHECK (origin IN ('ADMIN', 'SYSTEM', 'BID', 'TELESTAFF')),
  actor_subject TEXT NOT NULL CHECK (length(trim(actor_subject)) > 0),
  idempotency_key TEXT NOT NULL UNIQUE CHECK (
    length(trim(idempotency_key)) BETWEEN 1 AND 256
    AND idempotency_key = trim(idempotency_key)
  ),
  before_state TEXT NOT NULL CHECK (
    json_valid(before_state) = 1
    AND json_type(before_state) = 'object'
    AND (
      json_type(before_state, '$.employmentStatus') IS NULL
      OR json_extract(before_state, '$.employmentStatus') IN ('unknown', 'active', 'inactive', 'retired', 'separated')
    )
  ),
  after_state TEXT NOT NULL CHECK (
    json_valid(after_state) = 1
    AND json_type(after_state) = 'object'
    AND (
      json_type(after_state, '$.employmentStatus') IS NULL
      OR json_extract(after_state, '$.employmentStatus') IN ('unknown', 'active', 'inactive', 'retired', 'separated')
    )
  ),
  supersedes_event_id TEXT REFERENCES personnel_lifecycle_events(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL,
  CHECK (member_id IS NOT NULL OR staffing_position_id IS NOT NULL),
  CHECK (
    kind NOT IN ('POSITION_CREATE', 'POSITION_RETIRE')
    OR staffing_position_id IS NOT NULL
  ),
  CHECK (
    kind NOT IN ('NEW_HIRE', 'REACTIVATION', 'PROMOTION', 'DEMOTION', 'TRANSFER',
      'ADMIN_REASSIGNMENT', 'RETIREMENT', 'SEPARATION', 'VACATE')
    OR member_id IS NOT NULL
  ),
  CHECK (kind <> 'NEW_HIRE' OR employment_status_after = 'active'),
  CHECK (kind <> 'REACTIVATION' OR employment_status_after = 'active'),
  CHECK (kind <> 'RETIREMENT' OR employment_status_after = 'retired'),
  CHECK (kind <> 'SEPARATION' OR employment_status_after = 'separated')
);
--> statement-breakpoint
CREATE INDEX idx_personnel_lifecycle_events_member_effective
  ON personnel_lifecycle_events (member_id, effective_on, created_at);
--> statement-breakpoint
CREATE INDEX idx_personnel_lifecycle_events_position_effective
  ON personnel_lifecycle_events (staffing_position_id, effective_on, created_at);
--> statement-breakpoint
CREATE INDEX idx_personnel_lifecycle_events_assignment
  ON personnel_lifecycle_events (member_assignment_id, effective_on, created_at);
--> statement-breakpoint
CREATE TRIGGER personnel_lifecycle_events_are_immutable_update
BEFORE UPDATE ON personnel_lifecycle_events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'personnel lifecycle events are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER personnel_lifecycle_events_are_immutable_delete
BEFORE DELETE ON personnel_lifecycle_events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'personnel lifecycle events cannot be deleted');
END;
