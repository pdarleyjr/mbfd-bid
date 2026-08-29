-- Effective-dated credential and specialty evidence ledger.
--
-- `member_credentials` remains a compatibility projection for older readers.
-- This append-only table is the authoritative source for evidence-aware
-- lifecycle state and for future Bid snapshots as of their capture date.

CREATE TABLE member_qualification_events (
  id TEXT PRIMARY KEY NOT NULL,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  credential_id INTEGER REFERENCES credentials(id) ON DELETE RESTRICT,
  specialty_code TEXT,
  kind TEXT NOT NULL CHECK (kind IN (
    'CERTIFICATION_GAINED',
    'CERTIFICATION_EXPIRED',
    'CERTIFICATION_REVOKED',
    'SPECIALTY_QUALIFIED'
  )),
  effective_on TEXT NOT NULL CHECK (
    length(effective_on) = 10
    AND strftime('%Y-%m-%d', effective_on) IS NOT NULL
    AND strftime('%Y-%m-%d', effective_on) = effective_on
  ),
  expires_on TEXT CHECK (
    expires_on IS NULL
    OR (
      length(expires_on) = 10
      AND strftime('%Y-%m-%d', expires_on) IS NOT NULL
      AND strftime('%Y-%m-%d', expires_on) = expires_on
    )
  ),
  evidence_source TEXT NOT NULL CHECK (
    length(trim(evidence_source)) BETWEEN 1 AND 128
    AND evidence_source = trim(evidence_source)
  ),
  evidence_reference TEXT CHECK (
    evidence_reference IS NULL
    OR (
      length(trim(evidence_reference)) BETWEEN 1 AND 512
      AND evidence_reference = trim(evidence_reference)
    )
  ),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 4 AND 500),
  actor_subject TEXT NOT NULL CHECK (length(trim(actor_subject)) BETWEEN 1 AND 256),
  idempotency_key TEXT NOT NULL UNIQUE CHECK (
    length(trim(idempotency_key)) BETWEEN 1 AND 256
    AND idempotency_key = trim(idempotency_key)
  ),
  before_state TEXT NOT NULL CHECK (json_valid(before_state) = 1 AND json_type(before_state) = 'object'),
  after_state TEXT NOT NULL CHECK (json_valid(after_state) = 1 AND json_type(after_state) = 'object'),
  created_at INTEGER NOT NULL,
  CHECK (
    (
      kind IN ('CERTIFICATION_GAINED', 'CERTIFICATION_EXPIRED', 'CERTIFICATION_REVOKED')
      AND credential_id IS NOT NULL
      AND specialty_code IS NULL
    )
    OR (
      kind = 'SPECIALTY_QUALIFIED'
      AND credential_id IS NULL
      AND specialty_code IS NOT NULL
      AND length(trim(specialty_code)) BETWEEN 1 AND 128
      AND specialty_code = trim(specialty_code)
    )
  ),
  CHECK (expires_on IS NULL OR expires_on >= effective_on),
  CHECK (kind <> 'CERTIFICATION_EXPIRED' OR expires_on = effective_on),
  CHECK (kind <> 'CERTIFICATION_REVOKED' OR expires_on IS NULL)
);
--> statement-breakpoint
CREATE INDEX idx_member_qualification_events_member_effective
  ON member_qualification_events (member_id, effective_on, created_at, id);
--> statement-breakpoint
CREATE INDEX idx_member_qualification_events_credential_effective
  ON member_qualification_events (credential_id, effective_on, created_at, id);
--> statement-breakpoint
CREATE TRIGGER member_qualification_events_are_immutable_update
BEFORE UPDATE ON member_qualification_events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'qualification lifecycle events are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER member_qualification_events_are_immutable_delete
BEFORE DELETE ON member_qualification_events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'qualification lifecycle events cannot be deleted');
END;
--> statement-breakpoint

-- `audit_log.action` is stored as TEXT. This records the application-level
-- addition of `qualification_lifecycle`; no prior audit evidence is changed.
SELECT 1 FROM audit_log LIMIT 1;
