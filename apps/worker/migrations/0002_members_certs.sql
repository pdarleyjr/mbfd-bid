CREATE TABLE `members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`rank` text NOT NULL,
	`bid_category` text NOT NULL,
	`rsc_seniority` integer NOT NULL,
	`rank_seniority` integer,
	`hired_at` text,
	`promoted_at` text,
	`is_probationary` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_employee_id_unique` ON `members` (`employee_id`);--> statement-breakpoint
CREATE TABLE `credentials` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`fy_points_default` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credentials_name_unique` ON `credentials` (`name`);--> statement-breakpoint
CREATE TABLE `member_credentials` (
	`member_id` integer NOT NULL,
	`credential_id` integer NOT NULL,
	`start_date` text,
	`expiration_date` text,
	PRIMARY KEY(`member_id`, `credential_id`),
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`credential_id`) REFERENCES `credentials`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `member_credentials_credential_id_idx` ON `member_credentials` (`credential_id`);
