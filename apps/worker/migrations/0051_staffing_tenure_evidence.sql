CREATE TABLE staffing_tenure_evidence (
  id TEXT PRIMARY KEY,
  staffing_position_id TEXT NOT NULL REFERENCES staffing_positions(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK(revision>=1),
  effective_on TEXT NOT NULL CHECK(date(effective_on,'+0 days') IS effective_on),
  status TEXT NOT NULL CHECK(status IN ('PROTECTED','UNPROTECTED','UNKNOWN')),
  member_id INTEGER REFERENCES members(id) ON DELETE RESTRICT,
  protected_from TEXT,
  protected_through TEXT,
  source_ref TEXT NOT NULL CHECK(length(trim(source_ref))>=4),
  actor_subject TEXT NOT NULL,
  reason TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_json TEXT NOT NULL CHECK(json_valid(request_json)),
  created_at INTEGER NOT NULL,
  UNIQUE(staffing_position_id,revision),
  CHECK((status='PROTECTED' AND member_id IS NOT NULL AND protected_from IS NOT NULL AND protected_through IS NOT NULL AND date(protected_from,'+0 days') IS protected_from AND date(protected_through,'+0 days') IS protected_through AND protected_through>=protected_from)
    OR (status IN ('UNPROTECTED','UNKNOWN') AND member_id IS NULL AND protected_from IS NULL AND protected_through IS NULL))
);
CREATE TRIGGER staffing_tenure_revision_guard BEFORE INSERT ON staffing_tenure_evidence
WHEN NEW.revision IS NOT (SELECT COALESCE(MAX(revision),0)+1 FROM staffing_tenure_evidence WHERE staffing_position_id=NEW.staffing_position_id)
  OR NEW.effective_on < (SELECT MAX(effective_on) FROM staffing_tenure_evidence WHERE staffing_position_id=NEW.staffing_position_id)
BEGIN SELECT RAISE(ABORT,'tenure evidence revision or date changed'); END;
CREATE TRIGGER staffing_tenure_no_update BEFORE UPDATE ON staffing_tenure_evidence
BEGIN SELECT RAISE(ABORT,'tenure evidence is immutable'); END;
CREATE TRIGGER staffing_tenure_no_delete BEFORE DELETE ON staffing_tenure_evidence
BEGIN SELECT RAISE(ABORT,'tenure evidence is immutable'); END;
CREATE TRIGGER annual_source_tenure_insert AFTER INSERT ON staffing_tenure_evidence
BEGIN UPDATE annual_source_revision SET revision=revision+1 WHERE id=1; END;
