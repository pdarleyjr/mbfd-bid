-- Stable organizational identity, independent of seat existence and source labels.
CREATE TABLE organization_units (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('STATION','GROUP','APPARATUS')),
  created_at INTEGER NOT NULL
);
CREATE TABLE organization_unit_versions (
  unit_id TEXT NOT NULL REFERENCES organization_units(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  display_name TEXT NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 160),
  parent_id TEXT REFERENCES organization_units(id) ON DELETE RESTRICT,
  effective_on TEXT NOT NULL CHECK(date(effective_on,'+0 days') IS effective_on),
  status TEXT NOT NULL CHECK(status IN ('active','retired')),
  evidence_ref TEXT NOT NULL CHECK(length(trim(evidence_ref)) >= 4),
  actor_subject TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(length(trim(reason)) >= 4),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(unit_id, revision)
);
CREATE INDEX organization_versions_effective ON organization_unit_versions(unit_id,effective_on,revision);
CREATE TABLE organization_staffing_links (
  staffing_position_id TEXT NOT NULL REFERENCES staffing_positions(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  organization_unit_id TEXT REFERENCES organization_units(id) ON DELETE RESTRICT,
  effective_on TEXT NOT NULL CHECK(date(effective_on,'+0 days') IS effective_on),
  evidence_ref TEXT NOT NULL CHECK(length(trim(evidence_ref)) >= 4),
  actor_subject TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(length(trim(reason)) >= 4),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(staffing_position_id,revision)
);
CREATE INDEX organization_links_effective ON organization_staffing_links(staffing_position_id,effective_on,revision);
CREATE TABLE organization_command_receipts (
  idempotency_key TEXT PRIMARY KEY,
  actor_subject TEXT NOT NULL,
  request_json TEXT NOT NULL CHECK(json_valid(request_json)),
  response_json TEXT NOT NULL CHECK(json_valid(response_json)),
  created_at INTEGER NOT NULL
);
CREATE TRIGGER organization_identity_no_update BEFORE UPDATE ON organization_units
BEGIN SELECT RAISE(ABORT, 'organization identity is immutable'); END;
CREATE TRIGGER organization_identity_no_delete BEFORE DELETE ON organization_units
BEGIN SELECT RAISE(ABORT, 'organization identity is retained'); END;
CREATE TRIGGER organization_version_no_update BEFORE UPDATE ON organization_unit_versions
BEGIN SELECT RAISE(ABORT, 'organization history is immutable'); END;
CREATE TRIGGER organization_version_no_delete BEFORE DELETE ON organization_unit_versions
BEGIN SELECT RAISE(ABORT, 'organization history is retained'); END;
CREATE TRIGGER organization_link_no_update BEFORE UPDATE ON organization_staffing_links
BEGIN SELECT RAISE(ABORT, 'organization link history is immutable'); END;
CREATE TRIGGER organization_link_no_delete BEFORE DELETE ON organization_staffing_links
BEGIN SELECT RAISE(ABORT, 'organization link history is retained'); END;
CREATE TRIGGER organization_receipt_no_update BEFORE UPDATE ON organization_command_receipts
BEGIN SELECT RAISE(ABORT, 'organization receipt is immutable'); END;
CREATE TRIGGER organization_receipt_no_delete BEFORE DELETE ON organization_command_receipts
BEGIN SELECT RAISE(ABORT, 'organization receipt is immutable'); END;
CREATE TRIGGER organization_version_order BEFORE INSERT ON organization_unit_versions
WHEN NEW.revision <> COALESCE((SELECT MAX(revision) FROM organization_unit_versions WHERE unit_id=NEW.unit_id),0)+1
  OR NEW.effective_on < COALESCE((SELECT MAX(effective_on) FROM organization_unit_versions WHERE unit_id=NEW.unit_id),'0001-01-01')
BEGIN SELECT RAISE(ABORT, 'organization revision or effective date changed'); END;
CREATE TRIGGER organization_link_order BEFORE INSERT ON organization_staffing_links
WHEN NEW.revision <> COALESCE((SELECT MAX(revision) FROM organization_staffing_links WHERE staffing_position_id=NEW.staffing_position_id),0)+1
  OR NEW.effective_on < COALESCE((SELECT MAX(effective_on) FROM organization_staffing_links WHERE staffing_position_id=NEW.staffing_position_id),'0001-01-01')
BEGIN SELECT RAISE(ABORT, 'organization link revision or effective date changed'); END;
CREATE TRIGGER organization_parent_valid BEFORE INSERT ON organization_unit_versions
WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM organization_units child JOIN organization_units parent ON parent.id=NEW.parent_id
  JOIN organization_unit_versions pv ON pv.unit_id=parent.id
    AND pv.revision=(SELECT revision FROM organization_unit_versions WHERE unit_id=parent.id AND effective_on<=NEW.effective_on ORDER BY effective_on DESC,revision DESC LIMIT 1)
  WHERE child.id=NEW.unit_id AND pv.status='active'
    AND NOT EXISTS (SELECT 1 FROM organization_unit_versions future WHERE future.unit_id=parent.id AND future.status='retired' AND future.effective_on>NEW.effective_on)
    AND ((child.kind='STATION' AND parent.kind='GROUP') OR (child.kind='APPARATUS' AND parent.kind IN ('STATION','GROUP')))
)
BEGIN SELECT RAISE(ABORT, 'organization parent is not valid at effective date'); END;
CREATE TRIGGER organization_apparatus_requires_parent BEFORE INSERT ON organization_unit_versions
WHEN NEW.parent_id IS NULL AND (SELECT kind FROM organization_units WHERE id=NEW.unit_id)='APPARATUS'
BEGIN SELECT RAISE(ABORT, 'apparatus requires a reviewed parent'); END;
CREATE TRIGGER organization_link_active BEFORE INSERT ON organization_staffing_links
WHEN NEW.organization_unit_id IS NOT NULL AND (
  COALESCE((SELECT status FROM organization_unit_versions WHERE unit_id=NEW.organization_unit_id AND effective_on<=NEW.effective_on ORDER BY effective_on DESC,revision DESC LIMIT 1),'missing') <> 'active'
  OR EXISTS (SELECT 1 FROM organization_unit_versions WHERE unit_id=NEW.organization_unit_id AND status='retired' AND effective_on>NEW.effective_on)
)
BEGIN SELECT RAISE(ABORT, 'organization link requires active reviewed organization'); END;
CREATE TRIGGER organization_link_seat_active BEFORE INSERT ON organization_staffing_links
WHEN NOT EXISTS (SELECT 1 FROM staffing_positions WHERE id=NEW.staffing_position_id AND review_status IN ('approved','retired')
  AND (active_from IS NULL OR active_from<=NEW.effective_on) AND (active_to IS NULL OR active_to>=NEW.effective_on))
BEGIN SELECT RAISE(ABORT, 'organization link requires an authorized seat at the effective date'); END;
CREATE TRIGGER organization_retirement_dependencies BEFORE INSERT ON organization_unit_versions
WHEN NEW.status='retired' AND (
  EXISTS (SELECT 1 FROM organization_unit_versions child WHERE child.parent_id=NEW.unit_id AND child.status='active'
    AND NOT EXISTS (SELECT 1 FROM organization_unit_versions successor WHERE successor.unit_id=child.unit_id AND successor.revision>child.revision AND successor.effective_on<=MAX(NEW.effective_on,child.effective_on)))
  OR EXISTS (SELECT 1 FROM organization_staffing_links link JOIN staffing_positions seat ON seat.id=link.staffing_position_id
    WHERE link.organization_unit_id=NEW.unit_id
      AND (seat.active_to IS NULL OR seat.active_to>=MAX(NEW.effective_on,link.effective_on))
      AND NOT EXISTS (SELECT 1 FROM organization_staffing_links successor WHERE successor.staffing_position_id=link.staffing_position_id AND successor.revision>link.revision AND successor.effective_on<=MAX(NEW.effective_on,link.effective_on)))
)
BEGIN SELECT RAISE(ABORT, 'organization has active or future dependencies'); END;
CREATE TRIGGER organization_source_revision AFTER INSERT ON organization_unit_versions
BEGIN UPDATE annual_source_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER organization_link_source_revision AFTER INSERT ON organization_staffing_links
BEGIN UPDATE annual_source_revision SET revision=revision+1 WHERE id=1; END;
