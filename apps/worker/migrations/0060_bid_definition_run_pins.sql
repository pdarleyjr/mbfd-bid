-- Nullable, without a backfill: historical runs retain their exact snapshot
-- bytes and do not acquire inferred Bid-version provenance.
ALTER TABLE bid_session_policy_snapshots ADD COLUMN bid_version_id TEXT
 REFERENCES bid_definition_versions(id) ON DELETE RESTRICT;
ALTER TABLE bid_session_policy_snapshots ADD COLUMN bid_version_sha256 TEXT;
ALTER TABLE bid_session_policy_snapshots ADD COLUMN snapshot_sha256 TEXT;
ALTER TABLE bid_session_policy_snapshots ADD COLUMN context_sha256 TEXT;

-- UPDATE has always been forbidden. INSERT OR REPLACE bypasses that guard,
-- even with recursive_triggers=OFF, unless the conflicting INSERT is rejected.
CREATE TRIGGER bid_session_policy_snapshots_no_replace
BEFORE INSERT ON bid_session_policy_snapshots
WHEN EXISTS(SELECT 1 FROM bid_session_policy_snapshots
 WHERE bid_session_id=NEW.bid_session_id OR rowid=NEW.rowid)
BEGIN SELECT RAISE(ABORT,'bid session policy snapshot is immutable'); END;

CREATE TRIGGER bid_session_policy_snapshots_pin_required
BEFORE INSERT ON bid_session_policy_snapshots
WHEN ((NEW.bid_version_id IS NOT NULL)+(NEW.bid_version_sha256 IS NOT NULL)
 +(NEW.snapshot_sha256 IS NOT NULL)+(NEW.context_sha256 IS NOT NULL)) NOT IN (0,4)
 OR (NEW.bid_version_id IS NULL AND (
   json_type(NEW.snapshot_json,'$.bidDefinition') IS NOT NULL
   OR EXISTS(SELECT 1 FROM bid_sessions s JOIN bid_definition_heads h ON h.bid_year=s.bid_year
     WHERE s.id=NEW.bid_session_id)
   OR EXISTS(SELECT 1 FROM bid_definition_versions v
     WHERE v.rule_book_version=NEW.rule_book_version
      OR v.position_template_version=NEW.position_template_version)))
BEGIN SELECT RAISE(ABORT,'bid session version pin is required and must be complete'); END;

-- This is a storage identity/format guard, not a cryptographic validator or
-- publication approval. Application adapters must verify the exact snapshot
-- digest, immutable version material and independently derived runtime context.
-- Older saved versions remain valid: there is deliberately no head comparison.
CREATE TRIGGER bid_session_policy_snapshots_pin_identity
BEFORE INSERT ON bid_session_policy_snapshots
WHEN NEW.bid_version_id IS NOT NULL AND (
 EXISTS(SELECT 1 FROM (
   SELECT NEW.bid_session_id AS identity UNION ALL SELECT NEW.bid_version_id
   UNION ALL SELECT NEW.rule_book_version UNION ALL SELECT NEW.position_template_version
 ) WHERE typeof(identity)<>'text' OR length(identity)=0 OR identity IS NOT trim(identity,
   char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)))
 OR EXISTS(SELECT 1 FROM (
   SELECT NEW.bid_version_sha256 AS digest UNION ALL SELECT NEW.snapshot_sha256
   UNION ALL SELECT NEW.context_sha256
 ) WHERE typeof(digest)<>'text' OR length(digest)<>64
   OR digest GLOB '*[^0-9a-f]*' OR instr(digest,char(0))>0)
 OR typeof(NEW.captured_at)<>'integer' OR NEW.captured_at<0
 OR typeof(NEW.rule_book_revision)<>'integer' OR NEW.rule_book_revision<0
 OR json_type(NEW.snapshot_json) IS NOT 'object'
 OR json_type(NEW.snapshot_json,'$.v') IS NOT 'integer'
 OR json_extract(NEW.snapshot_json,'$.v') IS NOT 3
 OR json_type(NEW.snapshot_json,'$.ruleBookVersion') IS NOT 'text'
 OR json_extract(NEW.snapshot_json,'$.ruleBookVersion') IS NOT NEW.rule_book_version
 OR json_type(NEW.snapshot_json,'$.positionTemplateVersion') IS NOT 'text'
 OR json_extract(NEW.snapshot_json,'$.positionTemplateVersion') IS NOT NEW.position_template_version
 OR json_type(NEW.snapshot_json,'$.ruleBookRevision') IS NOT 'integer'
 OR json_extract(NEW.snapshot_json,'$.ruleBookRevision') IS NOT NEW.rule_book_revision
 OR json_type(NEW.snapshot_json,'$.capturedAtMs') IS NOT 'integer'
 OR json_extract(NEW.snapshot_json,'$.capturedAtMs') IS NOT NEW.captured_at
 OR json_type(NEW.snapshot_json,'$.bidDefinition') IS NOT 'object'
 OR json_type(NEW.snapshot_json,'$.bidDefinition.v') IS NOT 'integer'
 OR json_extract(NEW.snapshot_json,'$.bidDefinition.v') IS NOT 1
 OR json_type(NEW.snapshot_json,'$.bidDefinition.bidSessionId') IS NOT 'text'
 OR json_extract(NEW.snapshot_json,'$.bidDefinition.bidSessionId') IS NOT NEW.bid_session_id
 OR json_type(NEW.snapshot_json,'$.bidDefinition.bidYear') IS NOT 'integer'
 OR json_extract(NEW.snapshot_json,'$.bidDefinition.bidYear') NOT BETWEEN 2024 AND 2100
 OR json_type(NEW.snapshot_json,'$.bidDefinition.versionId') IS NOT 'text'
 OR json_extract(NEW.snapshot_json,'$.bidDefinition.versionId') IS NOT NEW.bid_version_id
 OR json_type(NEW.snapshot_json,'$.bidDefinition.versionSha256') IS NOT 'text'
 OR json_extract(NEW.snapshot_json,'$.bidDefinition.versionSha256') IS NOT NEW.bid_version_sha256
 OR json_type(NEW.snapshot_json,'$.bidDefinition.contextSha256') IS NOT 'text'
 OR json_extract(NEW.snapshot_json,'$.bidDefinition.contextSha256') IS NOT NEW.context_sha256
 OR (SELECT count(*) FROM json_each(NEW.snapshot_json,'$.bidDefinition'))<>6
 OR EXISTS(SELECT 1 FROM json_each(NEW.snapshot_json,'$.bidDefinition')
   WHERE key NOT IN ('v','bidSessionId','bidYear','versionId','versionSha256','contextSha256'))
 -- Duplicate JSON keys have different interpretations in SQLite and JS.
 OR EXISTS(SELECT 1 FROM json_each(NEW.snapshot_json) GROUP BY key HAVING count(*)>1)
 OR EXISTS(SELECT 1 FROM json_each(NEW.snapshot_json,'$.bidDefinition') GROUP BY key HAVING count(*)>1)
 OR json_type(NEW.snapshot_json,'$.settings') IS NOT 'object'
 OR EXISTS(SELECT 1 FROM json_each(NEW.snapshot_json,'$.settings') GROUP BY key HAVING count(*)>1)
 OR json_type(NEW.snapshot_json,'$.settings.expectedDurationDays') IS NOT 'integer'
 OR json_type(NEW.snapshot_json,'$.settings.turnTimerSeconds') IS NOT 'integer'
 OR json_extract(NEW.snapshot_json,'$.settings.expectedDurationDays') NOT BETWEEN 1 AND 7
 OR json_extract(NEW.snapshot_json,'$.settings.turnTimerSeconds') NOT BETWEEN 30 AND 600
 OR NOT EXISTS(SELECT 1 FROM bid_sessions s JOIN bid_definition_versions v ON v.id=NEW.bid_version_id
   WHERE s.id=NEW.bid_session_id AND s.bid_year=v.bid_year
    AND s.bid_year=json_extract(NEW.snapshot_json,'$.bidDefinition.bidYear')
    AND s.is_mock IN (0,1)
    AND s.turn_timer_seconds=json_extract(NEW.snapshot_json,'$.settings.turnTimerSeconds')
    AND s.expected_duration_days=json_extract(NEW.snapshot_json,'$.settings.expectedDurationDays')
    AND v.content_sha256=NEW.bid_version_sha256
    AND v.rule_book_version=NEW.rule_book_version
    AND v.position_template_version=NEW.position_template_version
    AND v.rule_book_revision=NEW.rule_book_revision)
)
BEGIN SELECT RAISE(ABORT,'bid session version pin identity is invalid'); END;

CREATE TRIGGER bid_session_policy_snapshots_pinned_no_delete
BEFORE DELETE ON bid_session_policy_snapshots
WHEN OLD.bid_version_id IS NOT NULL
BEGIN SELECT RAISE(ABORT,'pinned bid session policy snapshot is immutable'); END;

-- bid_sessions has its primary-key unique index and implicit rowid. Protect
-- INSERT/UPDATE replacement through either key from an unpinned session.
CREATE TRIGGER bid_sessions_pinned_no_replace BEFORE INSERT ON bid_sessions
WHEN EXISTS(SELECT 1 FROM bid_session_policy_snapshots p JOIN bid_sessions s ON s.id=p.bid_session_id
 WHERE (s.id=NEW.id OR s.rowid=NEW.rowid) AND p.bid_version_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'pinned bid session identity is immutable'); END;

CREATE TRIGGER bid_sessions_pinned_identity BEFORE UPDATE ON bid_sessions
WHEN (EXISTS(SELECT 1 FROM bid_session_policy_snapshots p
  WHERE p.bid_session_id=OLD.id AND p.bid_version_id IS NOT NULL)
 AND (NEW.id IS NOT OLD.id OR NEW.rowid IS NOT OLD.rowid
  OR NEW.bid_year IS NOT OLD.bid_year OR NEW.is_mock IS NOT OLD.is_mock
  OR NEW.config_json IS NOT OLD.config_json OR NEW.turn_timer_seconds IS NOT OLD.turn_timer_seconds
  OR NEW.expected_duration_days IS NOT OLD.expected_duration_days))
 OR EXISTS(SELECT 1 FROM bid_session_policy_snapshots p JOIN bid_sessions s ON s.id=p.bid_session_id
  WHERE s.id<>OLD.id AND (s.id=NEW.id OR s.rowid=NEW.rowid) AND p.bid_version_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'pinned bid session identity is immutable'); END;

CREATE TRIGGER bid_sessions_pinned_no_delete BEFORE DELETE ON bid_sessions
WHEN EXISTS(SELECT 1 FROM bid_session_policy_snapshots p
 WHERE p.bid_session_id=OLD.id AND p.bid_version_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'pinned bid session identity is immutable'); END;
