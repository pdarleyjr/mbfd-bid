CREATE TABLE admin_configuration_receipts (
  idempotency_key TEXT PRIMARY KEY,
  actor_subject TEXT NOT NULL,
  operation TEXT NOT NULL,
  request_json TEXT NOT NULL CHECK(json_valid(request_json)),
  response_json TEXT NOT NULL CHECK(json_valid(response_json)),
  created_at INTEGER NOT NULL
);
CREATE TRIGGER admin_configuration_receipts_no_replace BEFORE INSERT ON admin_configuration_receipts
WHEN EXISTS(SELECT 1 FROM admin_configuration_receipts WHERE idempotency_key=NEW.idempotency_key)
BEGIN SELECT RAISE(ABORT,'configuration receipt is immutable'); END;
CREATE TRIGGER admin_configuration_receipts_no_update BEFORE UPDATE ON admin_configuration_receipts
BEGIN SELECT RAISE(ABORT,'configuration receipt is immutable'); END;
CREATE TRIGGER admin_configuration_receipts_no_delete BEFORE DELETE ON admin_configuration_receipts
BEGIN SELECT RAISE(ABORT,'configuration receipt is immutable'); END;

-- Managed plans publish together only after the exact completed Mock review.
CREATE TRIGGER managed_annual_book_freeze_required BEFORE UPDATE OF status ON rule_books
WHEN NEW.status='active' AND OLD.status<>'active'
  AND EXISTS(SELECT 1 FROM bid_years y JOIN annual_plan_reviews p ON p.bid_year=y.year WHERE y.rule_book_version=NEW.version)
  AND NOT EXISTS(SELECT 1 FROM annual_freeze_reviews f JOIN bid_years y ON y.year=f.bid_year WHERE y.rule_book_version=NEW.version AND f.rule_revision=NEW.revision AND f.configuration_revision=y.configuration_revision AND f.source_revision=(SELECT revision FROM annual_source_revision WHERE id=1))
BEGIN SELECT RAISE(ABORT,'managed annual plan requires completed Mock freeze'); END;
CREATE TRIGGER managed_annual_policy_freeze_required BEFORE UPDATE OF status ON annual_bid_policy_documents
WHEN NEW.status='PUBLISHED' AND OLD.status<>'PUBLISHED'
  AND EXISTS(SELECT 1 FROM annual_plan_reviews WHERE bid_year=NEW.effective_year)
  AND NOT EXISTS(SELECT 1 FROM annual_freeze_reviews f JOIN bid_years y ON y.year=f.bid_year JOIN rule_books b ON b.version=y.rule_book_version JOIN bid_session_policy_snapshots s ON s.bid_session_id=f.mock_session_id WHERE y.year=NEW.effective_year AND y.annual_policy_document_id=NEW.id AND y.rule_book_version=NEW.rule_book_version AND f.rule_revision=b.revision AND f.configuration_revision=y.configuration_revision AND f.source_revision=(SELECT revision FROM annual_source_revision WHERE id=1) AND json_extract(s.snapshot_json,'$.annualPolicyEvidence.documentId')=NEW.id)
BEGIN SELECT RAISE(ABORT,'managed annual plan requires completed Mock freeze'); END;
