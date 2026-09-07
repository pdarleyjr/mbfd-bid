-- Reviewed cumulative totals are source facts, never inferred from a current seat.
CREATE TABLE service_credit_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(name))>=2),
  source_ref TEXT NOT NULL,
  actor_subject TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
INSERT INTO service_credit_types (id,name,source_ref,actor_subject,created_at)
VALUES ('RESCUE_DIVISION','Cumulative Rescue Division service','Capability only; no member credit or annual requirement is granted','schema',0);
CREATE TABLE member_service_evidence (
  id TEXT PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  service_code TEXT NOT NULL REFERENCES service_credit_types(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK(revision>=1),
  effective_on TEXT NOT NULL CHECK(date(effective_on,'+0 days') IS effective_on),
  verified_months INTEGER CHECK(verified_months IS NULL OR verified_months BETWEEN 0 AND 1200),
  source_ref TEXT NOT NULL CHECK(length(trim(source_ref))>=4),
  actor_subject TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(length(trim(reason))>=4),
  idempotency_key TEXT NOT NULL UNIQUE,
  request_json TEXT NOT NULL CHECK(json_valid(request_json)),
  created_at INTEGER NOT NULL,
  UNIQUE(member_id,service_code,revision)
);
CREATE TRIGGER member_service_revision_guard BEFORE INSERT ON member_service_evidence
WHEN NEW.revision IS NOT (SELECT COALESCE(MAX(revision),0)+1 FROM member_service_evidence WHERE member_id=NEW.member_id AND service_code=NEW.service_code)
 OR NEW.effective_on < (SELECT MAX(effective_on) FROM member_service_evidence WHERE member_id=NEW.member_id AND service_code=NEW.service_code)
BEGIN SELECT RAISE(ABORT,'service evidence revision or date changed'); END;
CREATE TRIGGER member_service_no_update BEFORE UPDATE ON member_service_evidence
BEGIN SELECT RAISE(ABORT,'service evidence is immutable'); END;
CREATE TRIGGER member_service_no_delete BEFORE DELETE ON member_service_evidence
BEGIN SELECT RAISE(ABORT,'service evidence is immutable'); END;
CREATE TRIGGER annual_source_service_insert AFTER INSERT ON member_service_evidence
BEGIN UPDATE annual_source_revision SET revision=revision+1 WHERE id=1; END;
