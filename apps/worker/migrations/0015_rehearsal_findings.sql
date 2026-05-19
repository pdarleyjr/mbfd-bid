-- Plan 09 / Rehearsal Tooling — Task R2.
--
-- In-app bug tracker for mock-draft rehearsals. Each row captures one
-- observation an admin/observer makes while exercising the system. The
-- screenshot (if attached) lives in R2 — only the key is stored here.
--
-- ON DELETE CASCADE on bid_session_id: when a session is torn down (e.g.
-- after Plan 09 cutover staging cleanup) its rehearsal findings vanish
-- with it. author_id is SET NULL so member deletion never blocks audit.

CREATE TABLE `rehearsal_findings` (
  `id` text PRIMARY KEY NOT NULL,
  `bid_session_id` text NOT NULL,
  `created_at` integer NOT NULL,
  `author_id` integer,
  `note` text NOT NULL,
  `screenshot_r2_key` text,
  FOREIGN KEY (`bid_session_id`) REFERENCES `bid_sessions`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`author_id`) REFERENCES `members`(`id`) ON DELETE SET NULL
);
CREATE INDEX `idx_rehearsal_findings_session` ON `rehearsal_findings` (`bid_session_id`, `created_at`);
