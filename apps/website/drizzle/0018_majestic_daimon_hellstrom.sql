CREATE TABLE `web_push_subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`endpoint_hash` text NOT NULL,
	`subscription_ciphertext` text NOT NULL,
	`device_name` text,
	`active` integer DEFAULT true NOT NULL,
	`expiration_at` integer,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `web_push_subscription_endpoint_hash_unique` ON `web_push_subscription` (`endpoint_hash`);--> statement-breakpoint
CREATE INDEX `web_push_subscription_user_active_idx` ON `web_push_subscription` (`user_id`,`active`);