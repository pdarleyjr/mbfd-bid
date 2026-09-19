-- Annual, source-certified Bid rankings. Never updates personnel or legacy seniority.
CREATE TABLE bid_ordinal_datasets (
  id TEXT PRIMARY KEY NOT NULL,
  bid_year INTEGER NOT NULL CHECK(bid_year BETWEEN 2024 AND 2100),
  revision INTEGER NOT NULL CHECK(revision > 0),
  source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64),
  source_ref TEXT NOT NULL,
  entries_json TEXT NOT NULL CHECK(json_valid(entries_json) AND json_type(entries_json)='array'),
  actor_subject TEXT NOT NULL,
  reason TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_json TEXT NOT NULL CHECK(json_valid(request_json)),
  created_at INTEGER NOT NULL,
  UNIQUE(bid_year,revision)
);
CREATE TRIGGER bid_ordinal_dataset_revision BEFORE INSERT ON bid_ordinal_datasets
WHEN NEW.revision != COALESCE((SELECT MAX(revision) FROM bid_ordinal_datasets WHERE bid_year=NEW.bid_year),0)+1
BEGIN SELECT RAISE(ABORT,'bid ordinal revision conflict'); END;
CREATE TRIGGER bid_ordinal_dataset_identity BEFORE INSERT ON bid_ordinal_datasets
WHEN json_array_length(NEW.entries_json)=0 OR EXISTS (
  SELECT 1 FROM json_each(NEW.entries_json) e
  WHERE json_type(e.value,'$.memberId') IS NOT 'integer'
    OR json_type(e.value,'$.employeeId') IS NOT 'text'
    OR json_type(e.value,'$.timeInGrade') IS NOT 'integer' OR json_extract(e.value,'$.timeInGrade')<1
    OR json_type(e.value,'$.departmentService') IS NOT 'integer' OR json_extract(e.value,'$.departmentService')<1
    OR NOT EXISTS (SELECT 1 FROM members m WHERE m.id=json_extract(e.value,'$.memberId') AND m.employee_id=json_extract(e.value,'$.employeeId'))
) OR EXISTS (SELECT 1 FROM json_each(NEW.entries_json) GROUP BY json_extract(value,'$.memberId') HAVING COUNT(*)>1)
  OR EXISTS (SELECT 1 FROM json_each(NEW.entries_json) GROUP BY json_extract(value,'$.employeeId') HAVING COUNT(*)>1)
  OR EXISTS (SELECT 1 FROM json_each(NEW.entries_json) GROUP BY json_extract(value,'$.timeInGrade') HAVING COUNT(*)>1)
  OR EXISTS (SELECT 1 FROM json_each(NEW.entries_json) GROUP BY json_extract(value,'$.departmentService') HAVING COUNT(*)>1)
BEGIN SELECT RAISE(ABORT,'bid ordinal identity or uniqueness conflict'); END;
CREATE TRIGGER bid_ordinal_dataset_no_update BEFORE UPDATE ON bid_ordinal_datasets
BEGIN SELECT RAISE(ABORT,'bid ordinal datasets are immutable'); END;
CREATE TRIGGER bid_ordinal_dataset_no_delete BEFORE DELETE ON bid_ordinal_datasets
BEGIN SELECT RAISE(ABORT,'bid ordinal datasets are immutable'); END;
CREATE TRIGGER bid_ordinal_dataset_source_revision AFTER INSERT ON bid_ordinal_datasets
BEGIN UPDATE annual_source_revision SET revision=revision+1 WHERE id=1; END;
