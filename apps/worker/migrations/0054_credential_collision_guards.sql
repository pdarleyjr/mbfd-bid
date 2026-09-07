-- Preserve existing identities, including any historical ambiguous labels.
-- Reject new case-insensitive cross-namespace collisions in the committing
-- transaction, so concurrent requests cannot bypass the API preview checks.
CREATE TRIGGER credential_new_name_no_casefold_collision
BEFORE INSERT ON credentials
WHEN EXISTS (SELECT 1 FROM credentials WHERE name = NEW.name COLLATE NOCASE)
  OR EXISTS (SELECT 1 FROM credential_catalog_metadata WHERE display_name = NEW.name COLLATE NOCASE)
BEGIN SELECT RAISE(ABORT, 'credential label collision requires review'); END;

CREATE TRIGGER credential_display_no_casefold_collision_insert
BEFORE INSERT ON credential_catalog_metadata
WHEN EXISTS (SELECT 1 FROM credentials WHERE id <> NEW.credential_id AND name = NEW.display_name COLLATE NOCASE)
  OR EXISTS (SELECT 1 FROM credential_catalog_metadata WHERE credential_id <> NEW.credential_id AND display_name = NEW.display_name COLLATE NOCASE)
BEGIN SELECT RAISE(ABORT, 'credential label collision requires review'); END;

CREATE TRIGGER credential_display_no_casefold_collision_update
BEFORE UPDATE OF display_name ON credential_catalog_metadata
WHEN NEW.display_name IS NOT OLD.display_name AND (
  EXISTS (SELECT 1 FROM credentials WHERE id <> NEW.credential_id AND name = NEW.display_name COLLATE NOCASE)
  OR EXISTS (SELECT 1 FROM credential_catalog_metadata WHERE credential_id <> NEW.credential_id AND display_name = NEW.display_name COLLATE NOCASE))
BEGIN SELECT RAISE(ABORT, 'credential label collision requires review'); END;
