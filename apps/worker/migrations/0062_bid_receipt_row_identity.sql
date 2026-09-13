-- Receipt identity is permanent, including SQLite's implicit rowid when
-- recursive delete triggers are disabled for INSERT/UPDATE OR REPLACE.
CREATE TRIGGER admin_configuration_receipts_rowid_no_replace
BEFORE INSERT ON admin_configuration_receipts
WHEN EXISTS(SELECT 1 FROM admin_configuration_receipts r WHERE r.rowid=NEW.rowid)
BEGIN SELECT RAISE(ABORT, 'configuration receipt row identity is immutable'); END;

CREATE TRIGGER admin_configuration_receipts_rowid_no_move
BEFORE UPDATE OF rowid ON admin_configuration_receipts
WHEN NEW.rowid IS NOT OLD.rowid
BEGIN SELECT RAISE(ABORT, 'configuration receipt row identity is immutable'); END;

CREATE TRIGGER annual_plan_receipts_no_replace
BEFORE INSERT ON annual_plan_receipts
WHEN EXISTS(SELECT 1 FROM annual_plan_receipts r
  WHERE r.idempotency_key=NEW.idempotency_key OR r.rowid=NEW.rowid)
BEGIN SELECT RAISE(ABORT, 'annual plan receipt identity is immutable'); END;

CREATE TRIGGER annual_plan_receipts_rowid_no_move
BEFORE UPDATE OF rowid ON annual_plan_receipts
WHEN NEW.rowid IS NOT OLD.rowid
BEGIN SELECT RAISE(ABORT, 'annual plan receipt row identity is immutable'); END;
