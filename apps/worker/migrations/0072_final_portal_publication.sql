-- Additive assignment outbox: retained assignments never acquire a bids row.
CREATE TABLE final_portal_publications (
  id TEXT PRIMARY KEY,
  bid_session_id TEXT NOT NULL REFERENCES bid_sessions(id) ON DELETE RESTRICT,
  source_sequence INTEGER NOT NULL,
  source_result_hash TEXT NOT NULL,
  source_workbook_sha256 TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL,
  manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),
  hub_identity_receipt_sha256 TEXT NOT NULL,
  actor_member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL,
  UNIQUE(bid_session_id, source_sequence)
);
CREATE TRIGGER final_portal_publication_guard BEFORE INSERT ON final_portal_publications
BEGIN
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM canonical_bid_session_state c JOIN bid_sessions s ON s.id=c.bid_session_id
    WHERE c.bid_session_id=NEW.bid_session_id AND c.current_seq=NEW.source_sequence
      AND s.is_mock=0 AND json_extract(c.state_json,'$.currentPhase')='complete'
  ) THEN RAISE(ABORT,'final_publication_stale_or_not_real_complete') END);
  SELECT (CASE WHEN EXISTS (
    SELECT 1 FROM final_portal_publications p WHERE p.bid_session_id=NEW.bid_session_id
      AND p.source_sequence=NEW.source_sequence AND
        (p.id<>NEW.id OR p.manifest_sha256<>NEW.manifest_sha256 OR
         p.source_result_hash<>NEW.source_result_hash OR
         p.hub_identity_receipt_sha256<>NEW.hub_identity_receipt_sha256)
  ) THEN RAISE(ABORT,'final_publication_revision_conflict') END);
END;
CREATE TRIGGER final_portal_publication_no_update BEFORE UPDATE ON final_portal_publications
BEGIN SELECT RAISE(ABORT,'final_publication_immutable'); END;
CREATE TRIGGER final_portal_publication_no_delete BEFORE DELETE ON final_portal_publications
BEGIN SELECT RAISE(ABORT,'final_publication_immutable'); END;
CREATE TABLE final_portal_outbox (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES final_portal_publications(id) ON DELETE RESTRICT,
  employee_id TEXT NOT NULL,
  position_id TEXT NOT NULL,
  assignment_source TEXT NOT NULL CHECK(assignment_source IN ('bid_award','retained_nonbiddable')),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  status TEXT NOT NULL CHECK(status IN ('queued','in_flight','done','failed','superseded')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  last_error TEXT,
  synced_at INTEGER,
  UNIQUE(publication_id, employee_id),
  UNIQUE(publication_id, position_id)
);
CREATE INDEX final_portal_outbox_due ON final_portal_outbox(status,next_attempt_at);
CREATE TRIGGER final_portal_outbox_immutable_payload BEFORE UPDATE ON final_portal_outbox
WHEN NEW.id<>OLD.id OR NEW.publication_id<>OLD.publication_id OR
  NEW.employee_id<>OLD.employee_id OR NEW.position_id<>OLD.position_id OR
  NEW.assignment_source<>OLD.assignment_source OR NEW.payload_json<>OLD.payload_json
BEGIN SELECT RAISE(ABORT,'final_outbox_source_immutable'); END;
CREATE TRIGGER final_portal_outbox_no_delete BEFORE DELETE ON final_portal_outbox
BEGIN SELECT RAISE(ABORT,'final_outbox_history_retained'); END;
