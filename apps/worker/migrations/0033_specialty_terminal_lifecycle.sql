-- Additive terminal-state evidence for specialty qualifications.
--
-- The original immutable ledger has a constrained `kind` column. Rebuilding
-- it would rewrite audit evidence, so terminal specialty semantics are stored
-- in this explicit companion discriminator while preserving the existing row
-- shape and idempotency key. Application reads expose the logical terminal
-- event kind; no existing event is altered.

ALTER TABLE member_qualification_events
  ADD COLUMN specialty_terminal_status TEXT CHECK (
    specialty_terminal_status IS NULL
    OR specialty_terminal_status IN ('EXPIRED', 'REVOKED', 'REMOVED')
  );
--> statement-breakpoint

CREATE INDEX idx_member_qualification_events_specialty_effective
  ON member_qualification_events (member_id, specialty_code, effective_on, created_at, id);
--> statement-breakpoint

CREATE TRIGGER member_qualification_events_specialty_terminal_shape
BEFORE INSERT ON member_qualification_events
FOR EACH ROW
WHEN NEW.specialty_terminal_status IS NOT NULL
 AND (
   NEW.kind <> 'SPECIALTY_QUALIFIED'
   OR NEW.credential_id IS NOT NULL
   OR NEW.specialty_code IS NULL
   OR (
     NEW.specialty_terminal_status = 'EXPIRED'
     AND (NEW.expires_on IS NULL OR NEW.expires_on <> NEW.effective_on)
   )
   OR (
     NEW.specialty_terminal_status IN ('REVOKED', 'REMOVED')
     AND NEW.expires_on IS NOT NULL
   )
 )
BEGIN
  SELECT RAISE(ABORT, 'invalid specialty terminal lifecycle event');
END;
