ALTER TABLE `agent_notification` ADD `status` text DEFAULT 'processing' NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_notification` ADD `failed_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_notification` ADD `error` text;--> statement-breakpoint
UPDATE `agent_notification`
SET `status` = CASE WHEN `accepted_count` > 0 THEN 'accepted' ELSE 'no_devices' END;--> statement-breakpoint
DROP TRIGGER `inbox_agent_notification_insert`;--> statement-breakpoint
DROP TRIGGER `inbox_agent_notification_update`;--> statement-breakpoint
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
    'notification', t.name, NEW.image_url, NEW.title, NEW.body, NEW.image_url, NEW.url,
    NEW.status,
    CASE WHEN NEW.status = 'accepted' THEN 'Accepted'
         WHEN NEW.status = 'partial' THEN 'Partially accepted'
         WHEN NEW.status = 'failed' THEN coalesce(NEW.error, 'Failed')
         WHEN NEW.status = 'no_devices' THEN 'No active devices'
         ELSE 'Processing' END,
    NEW.accepted_count, NEW.failed_count, 0, NEW.created_at, NEW.created_at
  FROM api_token t WHERE t.id = NEW.requester_token_id
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
         ELSE 'Processing' END,
    NEW.accepted_count, NEW.failed_count, NEW.created_at
  );
END;--> statement-breakpoint
CREATE TRIGGER `inbox_interaction_delete`
AFTER DELETE ON `interaction`
BEGIN
  UPDATE `inbox_item` SET
    `status` = CASE WHEN OLD.status = 'pending' THEN 'canceled' ELSE OLD.status END,
    `result` = CASE WHEN OLD.status = 'pending' THEN 'Source deleted'
                    WHEN `result` IS NULL THEN OLD.status
                    ELSE `result` END,
    `needs_action` = 0,
    `updated_at` = (unixepoch('subsec') * 1000)
  WHERE `entity_type` = 'interaction' AND `entity_id` = OLD.id;
  INSERT OR IGNORE INTO `inbox_item_event` (
    `id`, `inbox_item_id`, `dedupe_key`, `kind`, `detail`, `result`,
    `accepted_count`, `failed_count`, `occurred_at`
  )
  SELECT
    'iboxev:interaction-deleted:' || OLD.id,
    'ibox:interaction:' || OLD.id, 'terminal:source_deleted', 'source_deleted',
    'The originating service or token was deleted.',
    CASE WHEN OLD.status = 'pending' THEN 'Source deleted' ELSE OLD.status END,
    OLD.accepted_count, 0, (unixepoch('subsec') * 1000)
  WHERE EXISTS (
    SELECT 1 FROM `inbox_item`
    WHERE `entity_type` = 'interaction' AND `entity_id` = OLD.id
  );
END;--> statement-breakpoint
CREATE TRIGGER `inbox_live_activity_delete`
AFTER DELETE ON `live_activity`
BEGIN
  UPDATE `inbox_item` SET
    `status` = CASE WHEN OLD.status IN ('starting', 'active', 'partial')
      THEN 'canceled' ELSE OLD.status END,
    `result` = CASE WHEN OLD.status IN ('starting', 'active', 'partial')
      THEN 'Source deleted' WHEN `result` IS NULL THEN OLD.status ELSE `result` END,
    `updated_at` = (unixepoch('subsec') * 1000)
  WHERE `entity_type` = 'live_activity' AND `entity_id` = OLD.id;
  INSERT OR IGNORE INTO `inbox_item_event` (
    `id`, `inbox_item_id`, `dedupe_key`, `kind`, `detail`, `result`,
    `accepted_count`, `failed_count`, `occurred_at`
  )
  SELECT
    'iboxev:activity-deleted:' || OLD.id,
    CASE WHEN OLD.interaction_id IS NULL
      THEN 'ibox:live_activity:' || OLD.id
      ELSE 'ibox:interaction:' || OLD.interaction_id END,
    'terminal:source_deleted', 'source_deleted',
    'The originating service or token was deleted.',
    CASE WHEN OLD.status IN ('starting', 'active', 'partial')
      THEN 'Source deleted' ELSE OLD.status END,
    OLD.accepted_count, OLD.failed_count, (unixepoch('subsec') * 1000)
  WHERE EXISTS (
    SELECT 1 FROM `inbox_item`
    WHERE `id` = CASE WHEN OLD.interaction_id IS NULL
      THEN 'ibox:live_activity:' || OLD.id
      ELSE 'ibox:interaction:' || OLD.interaction_id END
  );
END;
