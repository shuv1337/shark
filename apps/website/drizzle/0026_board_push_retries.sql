CREATE TABLE `agent_notification_retry` (
	`id` text PRIMARY KEY NOT NULL,
	`notification_id` text NOT NULL,
	`user_id` text NOT NULL,
	`requester_token_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`notification_id`) REFERENCES `agent_notification`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requester_token_id`) REFERENCES `api_token`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_notification_retry_notification_idx` ON `agent_notification_retry` (`notification_id`);--> statement-breakpoint
CREATE INDEX `agent_notification_retry_user_created_at_idx` ON `agent_notification_retry` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_notification_retry_token_created_at_idx` ON `agent_notification_retry` (`requester_token_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `agent_notification` ADD `claim_id` text;--> statement-breakpoint
ALTER TABLE `agent_notification` ADD `claimed_at` integer;