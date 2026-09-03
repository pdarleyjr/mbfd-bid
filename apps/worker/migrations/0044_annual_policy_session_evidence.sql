-- The configured year points to the exact versioned annual policy document.
-- Session snapshots copy that document's immutable evidence so later drafts
-- or superseding publications cannot alter an already-created session.
ALTER TABLE bid_years ADD COLUMN annual_policy_document_id TEXT
  REFERENCES annual_bid_policy_documents(id) ON DELETE RESTRICT;

CREATE INDEX idx_bid_years_annual_policy_document
  ON bid_years (annual_policy_document_id);

CREATE TRIGGER annual_bid_policy_document_material_immutable
BEFORE UPDATE ON annual_bid_policy_documents
FOR EACH ROW
WHEN NEW.id <> OLD.id
  OR NEW.rule_book_version <> OLD.rule_book_version
  OR NEW.effective_year <> OLD.effective_year
  OR NEW.revision <> OLD.revision
  OR NEW.policy_text <> OLD.policy_text
  OR NEW.execution_policy_json <> OLD.execution_policy_json
  OR NEW.created_by IS NOT OLD.created_by
  OR NEW.created_at <> OLD.created_at
  OR NEW.supersedes_document_id IS NOT OLD.supersedes_document_id
BEGIN
  SELECT RAISE(ABORT, 'annual policy document material is immutable');
END;

CREATE TRIGGER annual_bid_policy_document_status_forward_only
BEFORE UPDATE OF status ON annual_bid_policy_documents
FOR EACH ROW
WHEN NOT (
  NEW.status = OLD.status
  OR (OLD.status = 'DRAFT' AND NEW.status = 'PUBLISHED')
  OR (OLD.status = 'PUBLISHED' AND NEW.status = 'SUPERSEDED')
)
BEGIN
  SELECT RAISE(ABORT, 'annual policy document status transition is invalid');
END;

-- Canonical commands were initially rehearsal-only. A pristine REAL session
-- may now seed canonical state only when it already owns a materialized V3
-- policy snapshot; legacy bid/A-Day rows remain an absolute import barrier.
DROP TRIGGER canonical_bid_session_state_seed_requires_pristine_legacy_state;

CREATE TRIGGER canonical_bid_session_state_seed_requires_pristine_legacy_state
BEFORE INSERT ON canonical_bid_session_state
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM bid_sessions session_record
  WHERE session_record.id = NEW.bid_session_id
    AND (
      session_record.is_mock = 1
      OR EXISTS (
        SELECT 1 FROM bid_session_policy_snapshots snapshot
        WHERE snapshot.bid_session_id = NEW.bid_session_id
          AND json_extract(snapshot.snapshot_json, '$.v') = 3
      )
    )
)
OR EXISTS (
  SELECT 1 FROM bids legacy_bid
  WHERE legacy_bid.bid_session_id = NEW.bid_session_id
)
OR EXISTS (
  SELECT 1 FROM a_day_picks legacy_a_day_pick
  WHERE legacy_a_day_pick.bid_session_id = NEW.bid_session_id
)
BEGIN
  SELECT RAISE(ABORT, 'canonical session seed requires pristine legacy-free mock or V3 state');
END;
