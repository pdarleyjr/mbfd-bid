CREATE TABLE `bid_years` (
	`year` integer PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`position_template_version` text,
	`rule_book_version` text,
	`config_json` text,
	FOREIGN KEY (`position_template_version`) REFERENCES `position_templates`(`version`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rule_book_version`) REFERENCES `rule_books`(`version`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `bid_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`bid_year` integer NOT NULL,
	`started_at` integer NOT NULL,
	`paused_at` integer,
	`completed_at` integer,
	`current_phase` text NOT NULL,
	`current_bidder_id` integer,
	`current_turn_started_at` integer,
	`turn_timer_seconds` integer DEFAULT 180 NOT NULL,
	`expected_duration_days` integer DEFAULT 2 NOT NULL,
	`scheduled_resume_at` integer,
	`day_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`bid_year`) REFERENCES `bid_years`(`year`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`current_bidder_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `bid_order` (
	`bid_session_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`member_id` integer NOT NULL,
	`pool` text NOT NULL,
	PRIMARY KEY(`bid_session_id`, `ordinal`),
	FOREIGN KEY (`bid_session_id`) REFERENCES `bid_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_bid_order_member_id` ON `bid_order` (`member_id`);
--> statement-breakpoint
CREATE TABLE `bids` (
	`id` text PRIMARY KEY NOT NULL,
	`bid_session_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`member_id` integer NOT NULL,
	`position_id` text NOT NULL,
	`r_day` text,
	`picked_at` integer NOT NULL,
	`forced` integer DEFAULT 0 NOT NULL,
	`admin_actor_id` integer,
	`reason` text,
	`idempotency_key` text NOT NULL,
	`portal_sync_status` text DEFAULT 'pending' NOT NULL,
	`portal_synced_at` integer,
	`portal_sync_attempts` integer DEFAULT 0 NOT NULL,
	`portal_last_error` text,
	FOREIGN KEY (`bid_session_id`) REFERENCES `bid_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`admin_actor_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bids_idempotency_key_unique` ON `bids` (`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `idx_bids_session_ordinal` ON `bids` (`bid_session_id`,`ordinal`);
--> statement-breakpoint
CREATE INDEX `idx_bids_member_id` ON `bids` (`member_id`);
--> statement-breakpoint
CREATE INDEX `idx_bids_portal_sync_status` ON `bids` (`portal_sync_status`);
--> statement-breakpoint
CREATE TABLE `portal_writeback_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`bid_id` text NOT NULL,
	`enqueued_at` integer NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`payload_json` text NOT NULL,
	`last_error` text,
	FOREIGN KEY (`bid_id`) REFERENCES `bids`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_portal_writeback_queue_status_next` ON `portal_writeback_queue` (`status`,`next_attempt_at`);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`bid_session_id` text NOT NULL,
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
	`client_meta` text NOT NULL,
	FOREIGN KEY (`bid_session_id`) REFERENCES `bid_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_audit_log_session_seq` ON `audit_log` (`bid_session_id`,`seq`);
--> statement-breakpoint
CREATE TABLE `ai_advisories` (
	`id` text PRIMARY KEY NOT NULL,
	`bid_session_id` text NOT NULL,
	`member_id` integer,
	`position_id` text,
	`triggered_by` text NOT NULL,
	`model` text NOT NULL,
	`prompt_hash` text NOT NULL,
	`response_json` text NOT NULL,
	`rendered_markdown` text NOT NULL,
	`latency_ms` integer NOT NULL,
	`cost_cents` integer NOT NULL,
	`cache_hit_ratio` real NOT NULL,
	FOREIGN KEY (`bid_session_id`) REFERENCES `bid_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_ai_advisories_session_triggered` ON `ai_advisories` (`bid_session_id`,`triggered_by`);
--> statement-breakpoint
CREATE TABLE `bid_session_snapshots` (
	`bid_session_id` text NOT NULL,
	`snapshot_at` integer NOT NULL,
	`state_json` text NOT NULL,
	PRIMARY KEY(`bid_session_id`, `snapshot_at`),
	FOREIGN KEY (`bid_session_id`) REFERENCES `bid_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_bid_session_snapshots_session_at` ON `bid_session_snapshots` (`bid_session_id`,`snapshot_at`);
