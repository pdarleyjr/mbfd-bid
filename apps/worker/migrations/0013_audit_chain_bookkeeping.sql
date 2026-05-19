-- Plan 08 Task 2 — audit chain bookkeeping.
--
-- Adds two tables (`audit_chunks`, `audit_chain_state`) and two columns on
-- `audit_log` (`chunk_seq`, `chunk_row_index`). The `portal_writeback_queue`
-- table and `bids.portal_sync_*` columns already exist (mig 0004) and are NOT
-- recreated here.

CREATE TABLE `audit_chunks` (
  `bid_session_id` text NOT NULL,
  `seq` integer NOT NULL,
  `r2_key` text NOT NULL,
  `sha256` text NOT NULL,
  `prev_sha256` text,
  `signature_b64u` text NOT NULL,
  `pubkey_b64u` text NOT NULL,
  `events_in_chunk` integer NOT NULL,
  `min_seq` integer NOT NULL,
  `max_seq` integer NOT NULL,
  `signed_at` integer NOT NULL,
  PRIMARY KEY (`bid_session_id`, `seq`),
  FOREIGN KEY (`bid_session_id`) REFERENCES `bid_sessions`(`id`) ON DELETE CASCADE
);
CREATE INDEX `idx_audit_chunks_session_seq` ON `audit_chunks` (`bid_session_id`, `seq`);

CREATE TABLE `audit_chain_state` (
  `bid_session_id` text PRIMARY KEY NOT NULL,
  `next_seq` integer NOT NULL DEFAULT 1,
  `pending_buffer_started_at` integer,
  `last_chunk_sha256` text,
  FOREIGN KEY (`bid_session_id`) REFERENCES `bid_sessions`(`id`) ON DELETE CASCADE
);

ALTER TABLE `audit_log` ADD COLUMN `chunk_seq` integer;
ALTER TABLE `audit_log` ADD COLUMN `chunk_row_index` integer;
