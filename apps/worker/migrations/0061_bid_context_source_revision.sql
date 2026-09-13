-- A pending adverse observation participates in Bid context through its member
-- and credential identities. Remapping either identity can change the dispute
-- query's result even when the review classification remains unchanged.
--
-- Keep 0056's classification-transition and applied-resolution invalidation.
-- This additive trigger covers only the remaining identity-only case, so a
-- combined classification/remap or application/remap does not increment twice.
CREATE TRIGGER targetsolutions_dispute_identity_invalidates_review
AFTER UPDATE OF member_id, credential_id ON targetsolutions_rows
WHEN (NEW.member_id IS NOT OLD.member_id OR NEW.credential_id IS NOT OLD.credential_id)
  AND NEW.classification IS OLD.classification
  AND NEW.classification IN ('CONFLICT','EXPIRATION_REVIEW','REVOCATION_REVIEW')
  AND OLD.applied_at IS NULL AND NEW.applied_at IS NULL
BEGIN
  UPDATE annual_source_revision SET revision=revision+1 WHERE id=1;
END;
