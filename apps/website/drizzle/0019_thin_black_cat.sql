CREATE TABLE `macos_device` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`apns_token_hash` text NOT NULL,
	`apns_token_ciphertext` text NOT NULL,
	`environment` text NOT NULL,
	`device_name` text,
	`privacy_mode` text DEFAULT 'standard' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `macos_device_apns_token_hash_unique` ON `macos_device` (`apns_token_hash`);--> statement-breakpoint
CREATE INDEX `macos_device_user_active_idx` ON `macos_device` (`user_id`,`active`);
