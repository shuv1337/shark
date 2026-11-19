CREATE TABLE `message_draft` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`creator_token_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`creation_digest` text NOT NULL,
	`recipient` text NOT NULL,
	`text` text NOT NULL,
	`revision` integer NOT NULL,
	`action_digest` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`operation_id` text,
	`provider_message_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_draft_creator_idempotency_idx` ON `message_draft` (`user_id`,`creator_token_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `message_draft_pending_idx` ON `message_draft` (`user_id`,`status`,`created_at`);