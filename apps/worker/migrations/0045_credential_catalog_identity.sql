-- Display/lifecycle metadata is separate from the legacy policy token.
-- No inferred mappings, new credential identities, or rewritten frozen rules.
CREATE TABLE credential_catalog_metadata (
  credential_id INTEGER PRIMARY KEY REFERENCES credentials(id) ON DELETE RESTRICT,
  display_name TEXT NOT NULL CHECK(length(trim(display_name)) BETWEEN 2 AND 160),
  revision INTEGER NOT NULL CHECK(revision >= 1),
  retired_on TEXT CHECK(retired_on IS NULL OR (length(retired_on) = 10 AND date(retired_on, '+0 days') IS retired_on))
);
CREATE UNIQUE INDEX credential_catalog_display_name ON credential_catalog_metadata(display_name);

CREATE TRIGGER credential_new_name_no_display_collision BEFORE INSERT ON credentials
WHEN EXISTS (SELECT 1 FROM credential_catalog_metadata WHERE display_name = NEW.name)
BEGIN SELECT RAISE(ABORT, 'credential display name already exists'); END;
CREATE TRIGGER credential_display_no_policy_collision_insert BEFORE INSERT ON credential_catalog_metadata
WHEN EXISTS (SELECT 1 FROM credentials WHERE name = NEW.display_name AND id <> NEW.credential_id)
BEGIN SELECT RAISE(ABORT, 'credential policy name already exists'); END;
CREATE TRIGGER credential_display_no_policy_collision_update BEFORE UPDATE OF display_name ON credential_catalog_metadata
WHEN EXISTS (SELECT 1 FROM credentials WHERE name = NEW.display_name AND id <> NEW.credential_id)
BEGIN SELECT RAISE(ABORT, 'credential policy name already exists'); END;

-- Legacy imports still write informational points through credentials. Their
-- changes must invalidate an already-open catalog editor too.
CREATE TRIGGER credential_points_advance_catalog_revision AFTER UPDATE OF fy_points_default ON credentials
WHEN NEW.fy_points_default IS NOT OLD.fy_points_default
BEGIN
  INSERT INTO credential_catalog_metadata (credential_id, display_name, revision)
    VALUES (NEW.id, NEW.name, 1)
    ON CONFLICT(credential_id) DO UPDATE SET revision = credential_catalog_metadata.revision + 1;
END;

-- Recheck active-policy dependencies in the committing transaction. Retirement
-- only removes an entry from future authoring; it cannot revoke held evidence.
CREATE TRIGGER credential_retirement_active_policy_insert
BEFORE INSERT ON credential_catalog_metadata
WHEN NEW.retired_on IS NOT NULL AND (
  EXISTS (SELECT 1 FROM position_rules r JOIN rule_books b ON b.version = r.rule_book_version
    JOIN credentials c ON c.id = NEW.credential_id
    WHERE b.status = 'active' AND (
      EXISTS (SELECT 1 FROM json_tree(r.required_criteria) WHERE value = c.name)
      OR EXISTS (SELECT 1 FROM json_tree(r.points_preference) WHERE value = c.name)))
  OR EXISTS (SELECT 1 FROM annual_bid_policy_documents p JOIN credentials c ON c.id = NEW.credential_id
    WHERE p.status = 'PUBLISHED' AND EXISTS (SELECT 1 FROM json_tree(p.execution_policy_json) WHERE value = c.name))
)
BEGIN
  SELECT RAISE(ABORT, 'credential is referenced by active policy');
END;
CREATE TRIGGER credential_retirement_active_policy_update
BEFORE UPDATE OF retired_on ON credential_catalog_metadata
WHEN NEW.retired_on IS NOT NULL AND NEW.retired_on IS NOT OLD.retired_on AND (
  EXISTS (SELECT 1 FROM position_rules r JOIN rule_books b ON b.version = r.rule_book_version
    JOIN credentials c ON c.id = NEW.credential_id
    WHERE b.status = 'active' AND (
      EXISTS (SELECT 1 FROM json_tree(r.required_criteria) WHERE value = c.name)
      OR EXISTS (SELECT 1 FROM json_tree(r.points_preference) WHERE value = c.name)))
  OR EXISTS (SELECT 1 FROM annual_bid_policy_documents p JOIN credentials c ON c.id = NEW.credential_id
    WHERE p.status = 'PUBLISHED' AND EXISTS (SELECT 1 FROM json_tree(p.execution_policy_json) WHERE value = c.name))
)
BEGIN
  SELECT RAISE(ABORT, 'credential is referenced by active policy');
END;

CREATE TABLE credential_catalog_receipts (
  idempotency_key TEXT PRIMARY KEY,
  credential_id INTEGER NOT NULL REFERENCES credentials(id) ON DELETE RESTRICT,
  actor_subject TEXT NOT NULL,
  request_json TEXT NOT NULL CHECK(json_valid(request_json)),
  response_json TEXT NOT NULL CHECK(json_valid(response_json)),
  created_at INTEGER NOT NULL
);

CREATE TRIGGER credential_policy_name_immutable
BEFORE UPDATE OF name ON credentials
WHEN NEW.name <> OLD.name
BEGIN
  SELECT RAISE(ABORT, 'credential policy name is immutable; update catalog display metadata');
END;

CREATE TRIGGER credential_catalog_receipt_immutable_update
BEFORE UPDATE ON credential_catalog_receipts
BEGIN
  SELECT RAISE(ABORT, 'credential catalog receipt is immutable');
END;
CREATE TRIGGER credential_catalog_receipt_immutable_delete
BEFORE DELETE ON credential_catalog_receipts
BEGIN
  SELECT RAISE(ABORT, 'credential catalog receipt is immutable');
END;
