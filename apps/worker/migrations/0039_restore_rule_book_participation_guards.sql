-- 0038 rebuilt rule_book_position_participation to extend its closed enum.
-- SQLite table replacement drops table triggers, so restore the existing
-- draft-only and rule-book-identity guards without changing stored rows.
CREATE TRIGGER rule_book_position_participation_draft_only_insert
BEFORE INSERT ON rule_book_position_participation
FOR EACH ROW
WHEN (SELECT status FROM rule_books WHERE version = NEW.rule_book_version) <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'rule book position participation is draft-only');
END;
--> statement-breakpoint
CREATE TRIGGER rule_book_position_participation_draft_only_update
BEFORE UPDATE ON rule_book_position_participation
FOR EACH ROW
WHEN (SELECT status FROM rule_books WHERE version = NEW.rule_book_version) <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'rule book position participation is draft-only');
END;
--> statement-breakpoint
CREATE TRIGGER rule_book_position_participation_rule_book_immutable
BEFORE UPDATE OF rule_book_version ON rule_book_position_participation
FOR EACH ROW
WHEN NEW.rule_book_version <> OLD.rule_book_version
BEGIN
  SELECT RAISE(ABORT, 'rule book position participation rule book is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER rule_book_position_participation_draft_only_delete
BEFORE DELETE ON rule_book_position_participation
FOR EACH ROW
WHEN (SELECT status FROM rule_books WHERE version = OLD.rule_book_version) <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'rule book position participation is draft-only');
END;
