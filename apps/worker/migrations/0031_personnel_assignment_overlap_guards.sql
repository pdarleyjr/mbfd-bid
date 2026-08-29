-- Personnel lifecycle changes close the current effective range before they
-- create the replacement range in one ordered D1 batch.  The preflight reads
-- in the admin route are intentionally advisory only: these database guards
-- make a stale/concurrent writer abort atomically instead of double-booking a
-- member after a later transaction has committed.
CREATE TRIGGER member_assignments_no_overlapping_member_insert
BEFORE INSERT ON member_assignments
FOR EACH ROW
WHEN NEW.status IN ('planned', 'active')
  AND EXISTS (
    SELECT 1
    FROM member_assignments existing
    WHERE existing.member_id = NEW.member_id
      AND existing.status IN ('planned', 'active')
      AND (existing.effective_to IS NULL OR existing.effective_to >= NEW.effective_from)
      AND (NEW.effective_to IS NULL OR NEW.effective_to >= existing.effective_from)
  )
BEGIN
  SELECT RAISE(ABORT, 'overlapping authoritative assignment for member');
END;
--> statement-breakpoint
CREATE TRIGGER member_assignments_no_overlapping_member_update
BEFORE UPDATE OF member_id, status, effective_from, effective_to ON member_assignments
FOR EACH ROW
WHEN NEW.status IN ('planned', 'active')
  AND EXISTS (
    SELECT 1
    FROM member_assignments existing
    WHERE existing.id <> NEW.id
      AND existing.member_id = NEW.member_id
      AND existing.status IN ('planned', 'active')
      AND (existing.effective_to IS NULL OR existing.effective_to >= NEW.effective_from)
      AND (NEW.effective_to IS NULL OR NEW.effective_to >= existing.effective_from)
  )
BEGIN
  SELECT RAISE(ABORT, 'overlapping authoritative assignment for member');
END;
--> statement-breakpoint

-- `personnel_lifecycle_events` is append-only evidence.  A supersession is a
-- narrow correction relationship, not a generic replacement mechanism.  The
-- route gives operators precise errors; these triggers preserve the same
-- invariant for any direct or concurrent database write.
CREATE TRIGGER personnel_lifecycle_events_supersession_requires_correction_insert
BEFORE INSERT ON personnel_lifecycle_events
FOR EACH ROW
WHEN NEW.supersedes_event_id IS NOT NULL
  AND NEW.kind <> 'CORRECTION'
BEGIN
  SELECT RAISE(ABORT, 'only a correction may supersede a lifecycle event');
END;
--> statement-breakpoint
CREATE TRIGGER personnel_lifecycle_events_supersession_requires_same_member_target_insert
BEFORE INSERT ON personnel_lifecycle_events
FOR EACH ROW
WHEN NEW.supersedes_event_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM personnel_lifecycle_events superseded
    WHERE superseded.id = NEW.supersedes_event_id
      AND superseded.member_id = NEW.member_id
      -- A targetless correction does not modify an assignment.  If it names a
      -- target, it must name the same target recorded by the evidence it
      -- corrects; cross-slot reassignment is a separate lifecycle event.
      AND (
        NEW.staffing_position_id IS NULL
        OR superseded.staffing_position_id = NEW.staffing_position_id
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'correction must supersede same-member compatible lifecycle evidence');
END;
