CREATE TABLE `watch_action` (
	`id` text PRIMARY KEY NOT NULL,
	`watch_device_id` text NOT NULL,
	`interaction_id` text NOT NULL,
	`request_id` text NOT NULL,
	`action` text NOT NULL,
	`action_digest` text NOT NULL,
	`accepted` integer NOT NULL,
	`terminal_status` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`watch_device_id`) REFERENCES `watch_device`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`interaction_id`) REFERENCES `interaction`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watch_action_device_request_unique` ON `watch_action` (`watch_device_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `watch_action_interaction_idx` ON `watch_action` (`interaction_id`);--> statement-breakpoint
CREATE TABLE `watch_device` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`apple_subject` text NOT NULL,
	`token_hash` text NOT NULL,
	`device_name` text,
	`active` integer DEFAULT true NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watch_device_token_hash_unique` ON `watch_device` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `watch_device_user_subject_unique` ON `watch_device` (`user_id`,`apple_subject`);--> statement-breakpoint
CREATE INDEX `watch_device_user_active_idx` ON `watch_device` (`user_id`,`active`);