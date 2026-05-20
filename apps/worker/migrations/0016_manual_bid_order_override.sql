-- Members section / Master Roster — Task A6.
--
-- Per-session manual override that re-positions a member in the computed
-- bid queue. The natural order is still derived from members.bidCategory +
-- rscSeniority + rankSeniority; rows in this table replace the ordinal a
-- particular member would otherwise occupy for one specific bid session.
--
-- ON DELETE CASCADE on bid_session_id and member_id: when either disappears
-- the override evaporates with it (a deleted session has nothing left to
-- override, and a deleted member can't be ordered).

CREATE TABLE `manual_bid_order_override` (
  `bid_session_id` text NOT NULL,
  `member_id` integer NOT NULL,
  `override_ordinal` integer NOT NULL,
  `created_at` integer NOT NULL,
  PRIMARY KEY (`bid_session_id`, `member_id`),
  FOREIGN KEY (`bid_session_id`) REFERENCES `bid_sessions`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE CASCADE
);
CREATE INDEX `idx_mbo_ordinal` ON `manual_bid_order_override` (`bid_session_id`, `override_ordinal`);
