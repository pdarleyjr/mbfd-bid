PRAGMA foreign_keys=off;
--> statement-breakpoint
CREATE TABLE `audit_log_new` (
	`id` text PRIMARY KEY NOT NULL,
	`bid_session_id` text REFERENCES `bid_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	`seq` integer NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` integer,
	`action` text NOT NULL,
	`target_kind` text,
	`target_id` text,
	`before_state` text,
	`after_state` text,
	`reason` text,
	`ai_advisory_id` text,
	`client_meta` text,
	`created_at` integer NOT NULL DEFAULT (strftime('%s', 'now'))
);
--> statement-breakpoint
INSERT INTO `audit_log_new` (
	`id`, `bid_session_id`, `seq`, `actor_type`, `actor_id`, `action`,
	`target_kind`, `target_id`, `before_state`, `after_state`, `reason`,
	`ai_advisory_id`, `client_meta`, `created_at`
)
SELECT
	`id`, `bid_session_id`, `seq`, `actor_type`, `actor_id`, `action`,
	`target_kind`, `target_id`, `before_state`, `after_state`, `reason`,
	`ai_advisory_id`, `client_meta`, strftime('%s', 'now')
FROM `audit_log`;
--> statement-breakpoint
DROP TABLE `audit_log`;
--> statement-breakpoint
ALTER TABLE `audit_log_new` RENAME TO `audit_log`;
--> statement-breakpoint
CREATE INDEX `audit_log_session_seq_idx` ON `audit_log` (`bid_session_id`,`seq`);
