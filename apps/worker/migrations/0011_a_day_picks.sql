-- 2026-05-19 — Plan 07 Task 9: A-Day picks table for Phase 2 of the bid.
-- Each row is one member's Phase 2 A-Day assignment.

CREATE TABLE `a_day_picks` (
    `id` text PRIMARY KEY NOT NULL,
    `bid_session_id` text NOT NULL,
    `member_id` integer NOT NULL,
    `shift` text NOT NULL,
    `a_day` text NOT NULL,
    `picked_at` integer NOT NULL,
    `forced` integer DEFAULT 0 NOT NULL,
    `admin_actor_id` integer,
    `reason` text,
    `idempotency_key` text NOT NULL,
    FOREIGN KEY (`bid_session_id`) REFERENCES `bid_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE restrict,
    FOREIGN KEY (`admin_actor_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `a_day_picks_session_member_unique` ON `a_day_picks` (`bid_session_id`, `member_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `a_day_picks_idempotency_key_unique` ON `a_day_picks` (`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `idx_a_day_picks_session_shift_aday` ON `a_day_picks` (`bid_session_id`, `shift`, `a_day`);
--> statement-breakpoint
CREATE INDEX `idx_a_day_picks_member` ON `a_day_picks` (`member_id`);
