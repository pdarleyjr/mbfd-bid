-- Unverified anomalous credential dates invalidate preparation just like
-- other unresolved source disputes. Existing evidence remains immutable.
CREATE TRIGGER targetsolutions_anomaly_invalidates_review
AFTER UPDATE OF classification ON targetsolutions_rows
WHEN NEW.classification IS NOT OLD.classification
 AND (NEW.classification='ANOMALOUS_DATE_REVIEW' OR OLD.classification='ANOMALOUS_DATE_REVIEW')
BEGIN UPDATE annual_source_revision SET revision=revision+1 WHERE id=1; END;

CREATE TRIGGER targetsolutions_anomaly_resolution_invalidates_review
AFTER UPDATE OF applied_at ON targetsolutions_rows
WHEN OLD.applied_at IS NULL AND NEW.applied_at IS NOT NULL
 AND OLD.classification='ANOMALOUS_DATE_REVIEW'
BEGIN UPDATE annual_source_revision SET revision=revision+1 WHERE id=1; END;
