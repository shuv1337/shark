CREATE TABLE `app_member_state` (
	`app_id` text NOT NULL,
	`user_id` text NOT NULL,
	`share_name` integer DEFAULT true NOT NULL,
	`share_email` integer DEFAULT false NOT NULL,
	`consented_at` integer,
	`last_opened_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `app`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_member_state_app_user_unique` ON `app_member_state` (`app_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `app_member_state_user_idx` ON `app_member_state` (`user_id`);--> statement-breakpoint
CREATE TABLE `oncall_group` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`name` text NOT NULL,
	`member_ids` text NOT NULL,
	`period` text NOT NULL,
	`handoff_at` text NOT NULL,
	`timezone` text NOT NULL,
	`starts_at` integer NOT NULL,
	`escalation` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oncall_group_team_idx` ON `oncall_group` (`team_id`);--> statement-breakpoint
CREATE TABLE `oncall_override` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`user_id` text NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `oncall_group`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oncall_override_group_ends_idx` ON `oncall_override` (`group_id`,`ends_at`);--> statement-breakpoint
CREATE TABLE `oncall_page` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`team_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`url` text,
	`app_id` text,
	`status` text NOT NULL,
	`dedup_key` text,
	`repeat_count` integer DEFAULT 0 NOT NULL,
	`escalation_step` integer DEFAULT 0 NOT NULL,
	`next_escalation_at` integer,
	`last_paged_user_id` text,
	`source_name` text NOT NULL,
	`created_by_user_id` text,
	`acknowledged_by_user_id` text,
	`acknowledged_at` integer,
	`resolved_by_user_id` text,
	`resolved_at` integer,
	`resolve_note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `oncall_group`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`app_id`) REFERENCES `app`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`acknowledged_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`resolved_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `oncall_page_team_created_idx` ON `oncall_page` (`team_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `oncall_page_escalation_idx` ON `oncall_page` (`status`,`next_escalation_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `oncall_page_open_dedup_unique` ON `oncall_page` (`group_id`,`dedup_key`) WHERE "oncall_page"."status" in ('triggered', 'acknowledged');--> statement-breakpoint
CREATE TABLE `oncall_page_recipient` (
	`page_id` text NOT NULL,
	`user_id` text NOT NULL,
	`step` integer NOT NULL,
	`response_token_hash` text NOT NULL,
	`accepted_count` integer DEFAULT 0 NOT NULL,
	`notified_at` integer NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `oncall_page`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oncall_page_recipient_page_user_unique` ON `oncall_page_recipient` (`page_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `oncall_page_recipient_token_unique` ON `oncall_page_recipient` (`response_token_hash`);--> statement-breakpoint
CREATE INDEX `oncall_page_recipient_user_idx` ON `oncall_page_recipient` (`user_id`,`notified_at`);--> statement-breakpoint
CREATE TABLE `team` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `team_invite` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`email` text,
	`role` text NOT NULL,
	`invited_by_user_id` text,
	`invited_by_name` text NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`accepted_by_user_id` text,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`accepted_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_invite_code_hash_unique` ON `team_invite` (`code_hash`);--> statement-breakpoint
CREATE INDEX `team_invite_team_created_idx` ON `team_invite` (`team_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `team_member` (
	`team_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`joined_at` integer NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_member_team_user_unique` ON `team_member` (`team_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `team_member_user_idx` ON `team_member` (`user_id`);--> statement-breakpoint
-- The durable inbox triggers name agent_notification, which blocks its rebuild.
DROP TRIGGER `inbox_agent_notification_insert`;--> statement-breakpoint
DROP TRIGGER `inbox_agent_notification_update`;--> statement-breakpoint
DROP TRIGGER `inbox_read_from_agent_notification`;--> statement-breakpoint
DROP TRIGGER `inbox_read_to_sources`;--> statement-breakpoint
DROP TRIGGER `inbox_read_on_insert`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent_notification` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`requester_token_id` text,
	`source_name` text,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`image_url` text,
	`url` text,
	`status` text DEFAULT 'processing' NOT NULL,
	`accepted_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`error` text,
	`idempotency_key` text,
	`request_hash` text,
	`app_id` text,
	`project_id` text,
	`read_at` integer,
	`body_format` text,
	`summary` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requester_token_id`) REFERENCES `api_token`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`app_id`) REFERENCES `app`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_agent_notification`("rowid", "id", "user_id", "requester_token_id", "source_name", "title", "body", "image_url", "url", "status", "accepted_count", "failed_count", "error", "idempotency_key", "request_hash", "app_id", "project_id", "read_at", "body_format", "summary", "created_at") SELECT "rowid", "id", "user_id", "requester_token_id", NULL, "title", "body", "image_url", "url", "status", "accepted_count", "failed_count", "error", "idempotency_key", "request_hash", "app_id", "project_id", "read_at", "body_format", "summary", "created_at" FROM `agent_notification`;--> statement-breakpoint
DROP TABLE `agent_notification`;--> statement-breakpoint
ALTER TABLE `__new_agent_notification` RENAME TO `agent_notification`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `agent_notification_token_idempotency_unique` ON `agent_notification` (`requester_token_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `agent_notification_user_created_at_idx` ON `agent_notification` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_notification_token_created_at_idx` ON `agent_notification` (`requester_token_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_notification_project_created_at_idx` ON `agent_notification` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_notification_unread_idx` ON `agent_notification` (`user_id`,`created_at`) WHERE "read_at" is null;--> statement-breakpoint
CREATE TRIGGER `inbox_agent_notification_insert`
AFTER INSERT ON `agent_notification`
BEGIN
  INSERT INTO `inbox_item` (
    `id`, `user_id`, `entity_type`, `entity_id`, `kind`, `source_name`, `source_image_url`,
    `title`, `body`, `image_url`, `url`, `status`, `result`, `accepted_count`,
    `failed_count`, `needs_action`, `occurred_at`, `updated_at`
  )
  SELECT
    'ibox:agent_notification:' || NEW.id, NEW.user_id, 'agent_notification', NEW.id,
    'notification', coalesce(NEW.source_name, t.name, NEW.title), NEW.image_url, NEW.title,
    NEW.body, NEW.image_url, NEW.url,
    NEW.status,
    CASE WHEN NEW.status = 'accepted' THEN 'Accepted'
         WHEN NEW.status = 'partial' THEN 'Partially accepted'
         WHEN NEW.status = 'failed' THEN coalesce(NEW.error, 'Failed')
         WHEN NEW.status = 'no_devices' THEN 'No active devices'
         ELSE 'Processing' END,
    NEW.accepted_count, NEW.failed_count, 0, NEW.created_at, NEW.created_at
  FROM (SELECT 1) LEFT JOIN api_token t ON t.id = NEW.requester_token_id
  ON CONFLICT(`entity_type`, `entity_id`) DO NOTHING;
END;--> statement-breakpoint
CREATE TRIGGER `inbox_agent_notification_update`
AFTER UPDATE OF `status`, `accepted_count`, `failed_count`, `error` ON `agent_notification`
BEGIN
  UPDATE `inbox_item` SET
    `status` = NEW.status,
    `result` = CASE WHEN NEW.status = 'accepted' THEN 'Accepted'
                    WHEN NEW.status = 'partial' THEN 'Partially accepted'
                    WHEN NEW.status = 'failed' THEN coalesce(NEW.error, 'Failed')
                    WHEN NEW.status = 'no_devices' THEN 'No active devices'
         WHEN NEW.status = 'withdrawn' THEN 'Withdrawn'
         WHEN NEW.status = 'withdraw_partial' THEN 'Partially withdrawn'
                    ELSE 'Processing' END,
    `accepted_count` = NEW.accepted_count,
    `failed_count` = NEW.failed_count,
    `updated_at` = NEW.created_at
  WHERE `entity_type` = 'agent_notification' AND `entity_id` = NEW.id;
  INSERT OR IGNORE INTO `inbox_item_event` (
    `id`, `inbox_item_id`, `dedupe_key`, `kind`, `detail`, `result`,
    `accepted_count`, `failed_count`, `occurred_at`
  ) VALUES (
    'iboxev:agent_notification:' || NEW.id || ':' || NEW.status,
    'ibox:agent_notification:' || NEW.id, 'delivery:' || NEW.status,
    'delivery', NEW.error,
    CASE WHEN NEW.status = 'accepted' THEN 'Accepted'
         WHEN NEW.status = 'partial' THEN 'Partially accepted'
         WHEN NEW.status = 'failed' THEN coalesce(NEW.error, 'Failed')
         WHEN NEW.status = 'no_devices' THEN 'No active devices'
         WHEN NEW.status = 'withdrawn' THEN 'Withdrawn'
         WHEN NEW.status = 'withdraw_partial' THEN 'Partially withdrawn'
         ELSE 'Processing' END,
    NEW.accepted_count, NEW.failed_count, NEW.created_at
  );
END;--> statement-breakpoint
CREATE TRIGGER inbox_read_from_agent_notification AFTER UPDATE OF read_at ON agent_notification
WHEN NEW.read_at IS NOT OLD.read_at
BEGIN
  UPDATE inbox_item SET read_at = NEW.read_at
  WHERE user_id = NEW.user_id AND entity_type = 'agent_notification'
    AND entity_id = NEW.id AND read_at IS NOT NEW.read_at;
END;--> statement-breakpoint
CREATE TRIGGER inbox_read_to_sources AFTER UPDATE OF read_at ON inbox_item
WHEN NEW.read_at IS NOT OLD.read_at
BEGIN
  UPDATE event SET read_at = NEW.read_at
  WHERE service_id IN (SELECT id FROM service WHERE user_id = NEW.user_id)
    AND ((NEW.entity_type = 'event' AND id = NEW.entity_id)
      OR (NEW.entity_type = 'interaction' AND id IN
        (SELECT event_id FROM interaction WHERE id = NEW.entity_id AND user_id = NEW.user_id)))
    AND read_at IS NOT NEW.read_at;
  UPDATE agent_notification SET read_at = NEW.read_at
  WHERE NEW.entity_type = 'agent_notification' AND id = NEW.entity_id
    AND user_id = NEW.user_id AND read_at IS NOT NEW.read_at;
END;--> statement-breakpoint
CREATE TRIGGER inbox_read_on_insert AFTER INSERT ON inbox_item
WHEN NEW.entity_type IN ('event', 'agent_notification', 'interaction')
BEGIN
  UPDATE inbox_item SET read_at = (
    SELECT e.read_at FROM event e JOIN service s ON s.id = e.service_id
    WHERE s.user_id = NEW.user_id
      AND ((NEW.entity_type = 'event' AND e.id = NEW.entity_id)
        OR (NEW.entity_type = 'interaction' AND e.id IN
          (SELECT event_id FROM interaction WHERE id = NEW.entity_id AND user_id = NEW.user_id)))
  ) WHERE id = NEW.id AND NEW.entity_type IN ('event', 'interaction') AND EXISTS (
    SELECT 1 FROM event e JOIN service s ON s.id = e.service_id
    WHERE s.user_id = NEW.user_id
      AND ((NEW.entity_type = 'event' AND e.id = NEW.entity_id)
        OR (NEW.entity_type = 'interaction' AND e.id IN
          (SELECT event_id FROM interaction WHERE id = NEW.entity_id AND user_id = NEW.user_id)))
  );
  UPDATE inbox_item SET read_at = (
    SELECT read_at FROM agent_notification WHERE id = NEW.entity_id AND user_id = NEW.user_id
  ) WHERE id = NEW.id AND NEW.entity_type = 'agent_notification' AND EXISTS (
    SELECT 1 FROM agent_notification WHERE id = NEW.entity_id AND user_id = NEW.user_id
  );
END;--> statement-breakpoint
ALTER TABLE `app` ADD `team_id` text REFERENCES team(id);--> statement-breakpoint
CREATE INDEX `app_team_id_idx` ON `app` (`team_id`);