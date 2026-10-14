ALTER TABLE `agent_notification` ADD `agent_display` text;--> statement-breakpoint
ALTER TABLE `interaction` ADD `agent_display` text;--> statement-breakpoint
DROP TRIGGER `inbox_agent_notification_insert`;--> statement-breakpoint
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
    'notification', coalesce(NEW.agent_display, NEW.source_name, t.name, NEW.title), NEW.image_url, NEW.title,
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
DROP TRIGGER `inbox_interaction_insert`;--> statement-breakpoint
CREATE TRIGGER `inbox_interaction_insert`
AFTER INSERT ON `interaction`
BEGIN
  DELETE FROM `inbox_item`
  WHERE `entity_type` = 'event' AND `entity_id` = NEW.event_id AND NEW.event_id IS NOT NULL;
  INSERT INTO `inbox_item` (
    `id`, `user_id`, `entity_type`, `entity_id`, `kind`, `source_name`, `source_image_url`,
    `title`, `body`, `image_url`, `url`, `status`, `result`, `accepted_count`,
    `failed_count`, `needs_action`, `occurred_at`, `updated_at`
  )
  SELECT
    'ibox:interaction:' || NEW.id, NEW.user_id, 'interaction', NEW.id, 'interaction',
    coalesce(s.title, NEW.agent_display, t.name, 'SHark'), coalesce(NEW.image_url, s.image_url),
    NEW.title, NEW.prompt, NEW.image_url, NEW.url, NEW.status, NULL,
    NEW.accepted_count, 0,
    CASE WHEN NEW.status = 'pending' AND NEW.expires_at > (unixepoch('subsec') * 1000)
      THEN 1 ELSE 0 END,
    NEW.created_at, NEW.created_at
  FROM (SELECT 1) seed
  LEFT JOIN service s ON s.id = NEW.requester_service_id
  LEFT JOIN api_token t ON t.id = NEW.requester_token_id
  WHERE true
  ON CONFLICT(`entity_type`, `entity_id`) DO NOTHING;
END;
