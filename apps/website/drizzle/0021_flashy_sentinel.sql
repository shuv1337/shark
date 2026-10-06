CREATE TABLE `board_ask` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`requester_token_id` text,
	`agent_label` text NOT NULL,
	`agent_display` text,
	`ask_key` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`kind` text NOT NULL,
	`options` text NOT NULL,
	`allow_text` integer DEFAULT false NOT NULL,
	`allow_later` integer DEFAULT true NOT NULL,
	`priority` text DEFAULT 'p1' NOT NULL,
	`waiting_task_id` text,
	`links` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`snooze_until` integer,
	`expires_at` integer,
	`answer_option_id` text,
	`answer_text` text,
	`answered_at` integer,
	`answered_via` text,
	`answered_by_device_id` text,
	`answered_session_hash` text,
	`cancel_reason` text,
	`action_digest` text NOT NULL,
	`push_notification_id` text,
	`callback_url` text,
	`callback_token_ciphertext` text,
	`callback_status` text,
	`callback_attempts` integer DEFAULT 0 NOT NULL,
	`callback_next_attempt_at` integer,
	`callback_last_error` text,
	`callback_delivered_at` integer,
	`resolved_at` integer,
	`acked_at` integer,
	`last_asserted_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requester_token_id`) REFERENCES `api_token`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`answered_by_device_id`) REFERENCES `device`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`push_notification_id`) REFERENCES `agent_notification`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `board_ask_open_key_unique` ON `board_ask` (`user_id`,`ask_key`) WHERE "board_ask"."status" = 'open';--> statement-breakpoint
CREATE INDEX `board_ask_user_status_idx` ON `board_ask` (`user_id`,`status`,`priority`,`created_at`);--> statement-breakpoint
CREATE INDEX `board_ask_token_resolved_idx` ON `board_ask` (`requester_token_id`,`resolved_at`);--> statement-breakpoint
CREATE INDEX `board_ask_callback_due_idx` ON `board_ask` (`callback_status`,`callback_next_attempt_at`);--> statement-breakpoint
CREATE INDEX `board_ask_expiry_idx` ON `board_ask` (`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `board_ask_event` (
	`id` text PRIMARY KEY NOT NULL,
	`ask_id` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`kind` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_ref` text,
	`revision` integer NOT NULL,
	`detail` text,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`ask_id`) REFERENCES `board_ask`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `board_ask_event_dedupe_unique` ON `board_ask_event` (`ask_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `board_ask_event_ask_occurred_idx` ON `board_ask_event` (`ask_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `board_note` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`requester_token_id` text,
	`agent_label` text NOT NULL,
	`agent_display` text,
	`note_key` text NOT NULL,
	`text` text NOT NULL,
	`detail` text,
	`link` text,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requester_token_id`) REFERENCES `api_token`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `board_note_user_key_unique` ON `board_note` (`user_id`,`note_key`);--> statement-breakpoint
CREATE INDEX `board_note_user_idx` ON `board_note` (`user_id`);--> statement-breakpoint
CREATE TABLE `board_work_item` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`requester_token_id` text,
	`agent_label` text NOT NULL,
	`agent_display` text,
	`work_key` text NOT NULL,
	`title` text NOT NULL,
	`state` text NOT NULL,
	`status_label` text,
	`detail` text,
	`progress` real,
	`links` text NOT NULL,
	`host` text,
	`waiting_ask_id` text,
	`started_at` integer,
	`last_heartbeat_at` integer NOT NULL,
	`heartbeat_ttl_seconds` integer DEFAULT 21600 NOT NULL,
	`completed_at` integer,
	`completion_verb` text,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requester_token_id`) REFERENCES `api_token`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`waiting_ask_id`) REFERENCES `board_ask`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `board_work_item_user_key_unique` ON `board_work_item` (`user_id`,`work_key`);--> statement-breakpoint
CREATE INDEX `board_work_item_user_state_idx` ON `board_work_item` (`user_id`,`state`,`completed_at`);--> statement-breakpoint
CREATE INDEX `board_work_item_token_idx` ON `board_work_item` (`requester_token_id`);