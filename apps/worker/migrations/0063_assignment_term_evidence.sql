-- Add reviewed term facts without rewriting any historical evidence row.
ALTER TABLE staffing_tenure_evidence ADD COLUMN term_member_id INTEGER REFERENCES members(id) ON DELETE RESTRICT
  CHECK(term_member_id IS NULL OR (typeof(term_member_id) = 'integer' AND term_member_id > 0));
ALTER TABLE staffing_tenure_evidence ADD COLUMN accumulated_service_months INTEGER
  CHECK(accumulated_service_months IS NULL OR (typeof(accumulated_service_months) = 'integer' AND accumulated_service_months BETWEEN 0 AND 1200));
ALTER TABLE staffing_tenure_evidence ADD COLUMN consecutive_bid_cycles INTEGER
  CHECK(consecutive_bid_cycles IS NULL OR (typeof(consecutive_bid_cycles) = 'integer' AND consecutive_bid_cycles BETWEEN 0 AND 100));
CREATE TRIGGER staffing_tenure_term_facts_guard BEFORE INSERT ON staffing_tenure_evidence
WHEN (NEW.term_member_id IS NULL AND (NEW.accumulated_service_months IS NOT NULL OR NEW.consecutive_bid_cycles IS NOT NULL))
 OR (NEW.term_member_id IS NOT NULL AND (NEW.accumulated_service_months IS NULL OR NEW.consecutive_bid_cycles IS NULL))
 OR (NEW.status='PROTECTED' AND NEW.term_member_id IS NOT NULL AND NEW.term_member_id != NEW.member_id)
BEGIN SELECT RAISE(ABORT,'assignment term facts must identify one reviewed holder'); END;
