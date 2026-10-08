CREATE TABLE `project` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_user_normalized_name_unique` ON `project` (`user_id`,`normalized_name`);--> statement-breakpoint
CREATE INDEX `project_user_created_at_idx` ON `project` (`user_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `agent_notification` ADD `project_id` text REFERENCES project(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `agent_notification` ADD `read_at` integer;--> statement-breakpoint
ALTER TABLE `agent_notification` ADD `body_format` text;--> statement-breakpoint
ALTER TABLE `agent_notification` ADD `summary` text;--> statement-breakpoint
CREATE INDEX `agent_notification_user_created_at_idx` ON `agent_notification` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_notification_project_created_at_idx` ON `agent_notification` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_notification_unread_idx` ON `agent_notification` (`user_id`,`created_at`) WHERE "read_at" is null;--> statement-breakpoint
ALTER TABLE `app` ADD `project_id` text REFERENCES project(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `event` ADD `project_id` text REFERENCES project(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `event` ADD `read_at` integer;--> statement-breakpoint
ALTER TABLE `event` ADD `body_format` text;--> statement-breakpoint
ALTER TABLE `event` ADD `summary` text;--> statement-breakpoint
CREATE INDEX `event_project_created_at_idx` ON `event` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `event_unread_idx` ON `event` (`service_id`,`created_at`) WHERE "read_at" is null;--> statement-breakpoint
ALTER TABLE `live_activity_operation` ADD `props` text;--> statement-breakpoint
CREATE INDEX `interaction_user_responded_at_idx` ON `interaction` (`user_id`,`responded_at`);--> statement-breakpoint
-- Preserve read state from SHark's existing durable inbox. Interactive webhook
-- deliveries are represented by their interaction rather than a duplicate event card.
UPDATE event SET read_at = (
  SELECT i.read_at FROM inbox_item i
  WHERE i.user_id = (SELECT user_id FROM service WHERE id = event.service_id)
    AND ((i.entity_type = 'event' AND i.entity_id = event.id)
      OR (i.entity_type = 'interaction' AND i.entity_id IN
        (SELECT id FROM interaction WHERE event_id = event.id)))
  LIMIT 1
);
--> statement-breakpoint
UPDATE agent_notification SET read_at = (
  SELECT i.read_at FROM inbox_item i WHERE i.entity_type = 'agent_notification'
    AND i.entity_id = agent_notification.id AND i.user_id = agent_notification.user_id
);
--> statement-breakpoint
-- Both API generations share one read state. Guards make these safe even when
-- recursive_triggers is enabled and keep a read-only sync from changing timestamps.
CREATE TRIGGER inbox_read_from_event AFTER UPDATE OF read_at ON event
WHEN NEW.read_at IS NOT OLD.read_at
BEGIN
  UPDATE inbox_item SET read_at = NEW.read_at
  WHERE user_id = (SELECT user_id FROM service WHERE id = NEW.service_id)
    AND ((entity_type = 'event' AND entity_id = NEW.id)
      OR (entity_type = 'interaction' AND entity_id IN
        (SELECT id FROM interaction WHERE event_id = NEW.id)))
    AND read_at IS NOT NEW.read_at;
END;
--> statement-breakpoint
CREATE TRIGGER inbox_read_from_agent_notification AFTER UPDATE OF read_at ON agent_notification
WHEN NEW.read_at IS NOT OLD.read_at
BEGIN
  UPDATE inbox_item SET read_at = NEW.read_at
  WHERE user_id = NEW.user_id AND entity_type = 'agent_notification'
    AND entity_id = NEW.id AND read_at IS NOT NEW.read_at;
END;
--> statement-breakpoint
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
END;
--> statement-breakpoint
-- Project clients may mark a source read before the durable inbox is materialized.
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
END;

--> statement-breakpoint
DROP TRIGGER `inbox_agent_notification_update`;
--> statement-breakpoint
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
END;
