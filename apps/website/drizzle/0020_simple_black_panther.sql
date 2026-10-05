CREATE TABLE `app` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`origin` text NOT NULL,
	`icon_url` text,
	`project_id` text,
	`share_name` integer DEFAULT true NOT NULL,
	`share_email` integer DEFAULT false NOT NULL,
	`consented_at` integer,
	`last_opened_at` integer,
	`created_by_token_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_token_id`) REFERENCES `api_token`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_user_url_unique` ON `app` (`user_id`,`url`);--> statement-breakpoint
CREATE INDEX `app_user_id_idx` ON `app` (`user_id`);--> statement-breakpoint
CREATE TABLE `app_signing_key` (
	`id` text PRIMARY KEY NOT NULL,
	`algorithm` text NOT NULL,
	`public_jwk` text NOT NULL,
	`private_jwk_ciphertext` text NOT NULL,
	`created_at` integer NOT NULL,
	`retired_at` integer
);
--> statement-breakpoint
ALTER TABLE `agent_notification` ADD `app_id` text REFERENCES app(id) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
ALTER TABLE `event` ADD `app_id` text REFERENCES app(id) ON UPDATE no action ON DELETE set null;