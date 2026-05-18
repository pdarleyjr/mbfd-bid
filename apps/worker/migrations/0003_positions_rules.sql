CREATE TABLE `position_templates` (
	`version` text PRIMARY KEY NOT NULL,
	`effective_year` integer NOT NULL,
	`notes` text
);
--> statement-breakpoint
CREATE TABLE `rule_books` (
	`version` text PRIMARY KEY NOT NULL,
	`effective_year` integer NOT NULL,
	`notes` text
);
--> statement-breakpoint
CREATE TABLE `positions` (
	`id` text NOT NULL,
	`template_version` text NOT NULL,
	`shift` text NOT NULL,
	`station` text NOT NULL,
	`division` text NOT NULL,
	`unit` text NOT NULL,
	`rank_required` text NOT NULL,
	`position_name` text NOT NULL,
	`is_floating` integer DEFAULT 0 NOT NULL,
	`is_vacant_by_design` integer DEFAULT 0 NOT NULL,
	`is_excluded_from_count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`id`, `template_version`),
	FOREIGN KEY (`template_version`) REFERENCES `position_templates`(`version`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_positions_template` ON `positions` (`template_version`);--> statement-breakpoint
CREATE INDEX `idx_positions_shift_station` ON `positions` (`shift`,`station`);--> statement-breakpoint
CREATE TABLE `position_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rule_book_version` text NOT NULL,
	`position_id` text NOT NULL,
	`template_version` text NOT NULL,
	`required_criteria` text NOT NULL,
	`points_preference` text NOT NULL,
	`tie_break_chain` text NOT NULL,
	`notes` text,
	FOREIGN KEY (`rule_book_version`) REFERENCES `rule_books`(`version`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_position_rules_rulebook_position` ON `position_rules` (`rule_book_version`,`position_id`,`template_version`);
