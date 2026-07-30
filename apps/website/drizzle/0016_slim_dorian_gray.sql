CREATE TABLE `inbox_item` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`kind` text NOT NULL,
	`source_name` text NOT NULL,
	`source_image_url` text,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`image_url` text,
	`url` text,
	`status` text NOT NULL,
	`result` text,
	`accepted_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`needs_action` integer DEFAULT false NOT NULL,
	`read_at` integer,
	`occurred_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbox_item_entity_unique` ON `inbox_item` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `inbox_item_user_occurred_idx` ON `inbox_item` (`user_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `inbox_item_user_action_idx` ON `inbox_item` (`user_id`,`needs_action`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `inbox_item_user_read_idx` ON `inbox_item` (`user_id`,`read_at`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `inbox_item_event` (
	`id` text PRIMARY KEY NOT NULL,
	`inbox_item_id` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`kind` text NOT NULL,
	`detail` text,
	`result` text,
	`accepted_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`inbox_item_id`) REFERENCES `inbox_item`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbox_item_event_dedupe_unique` ON `inbox_item_event` (`inbox_item_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `inbox_item_event_item_occurred_idx` ON `inbox_item_event` (`inbox_item_id`,`occurred_at`);--> statement-breakpoint
INSERT INTO `inbox_item` (
  `id`, `user_id`, `entity_type`, `entity_id`, `kind`, `source_name`, `source_image_url`,
  `title`, `body`, `image_url`, `url`, `status`, `result`, `accepted_count`,
  `failed_count`, `needs_action`, `occurred_at`, `updated_at`
)
SELECT
  'ibox:event:' || e.id, s.user_id, 'event', e.id, 'notification',
  s.title, coalesce(e.image_url, s.image_url), e.title, e.body, e.image_url, e.url,
  e.status,
  CASE WHEN e.status IN ('accepted', 'delivered') THEN 'Accepted'
       WHEN e.status = 'partial' THEN 'Partially accepted'
       WHEN e.status = 'no_devices' THEN 'No active devices'
       WHEN e.status = 'failed' THEN coalesce(e.error, 'Failed')
       ELSE NULL END,
  e.delivered_count, CASE WHEN e.status = 'failed' THEN 1 ELSE 0 END,
  0, e.created_at, e.created_at
FROM event e
INNER JOIN service s ON s.id = e.service_id
WHERE NOT EXISTS (SELECT 1 FROM interaction i WHERE i.event_id = e.id);--> statement-breakpoint
INSERT INTO `inbox_item` (
  `id`, `user_id`, `entity_type`, `entity_id`, `kind`, `source_name`, `source_image_url`,
  `title`, `body`, `image_url`, `url`, `status`, `result`, `accepted_count`,
  `failed_count`, `needs_action`, `occurred_at`, `updated_at`
)
SELECT
  'ibox:agent_notification:' || n.id, n.user_id, 'agent_notification', n.id, 'notification',
  t.name, n.image_url, n.title, n.body, n.image_url, n.url,
  CASE WHEN n.accepted_count > 0 THEN 'accepted' ELSE 'no_devices' END,
  CASE WHEN n.accepted_count > 0 THEN 'Accepted' ELSE 'No active devices' END,
  n.accepted_count, 0, 0, n.created_at, n.created_at
FROM agent_notification n
INNER JOIN api_token t ON t.id = n.requester_token_id;--> statement-breakpoint
INSERT INTO `inbox_item` (
  `id`, `user_id`, `entity_type`, `entity_id`, `kind`, `source_name`, `source_image_url`,
  `title`, `body`, `image_url`, `url`, `status`, `result`, `accepted_count`,
  `failed_count`, `needs_action`, `occurred_at`, `updated_at`
)
SELECT
  'ibox:interaction:' || i.id, i.user_id, 'interaction', i.id, 'interaction',
  coalesce(s.title, t.name, 'SHark'), coalesce(i.image_url, s.image_url),
  i.title, i.prompt, i.image_url, i.url, i.status,
  CASE WHEN i.status = 'approved' THEN 'Approved'
       WHEN i.status = 'denied' THEN 'Denied'
       WHEN i.status = 'yes' THEN 'Yes'
       WHEN i.status = 'no' THEN 'No'
       WHEN i.status = 'replied' THEN 'Replied'
       WHEN i.status = 'canceled' THEN 'Canceled'
       WHEN i.status = 'expired' THEN 'Expired'
       ELSE NULL END,
  i.accepted_count, 0,
  CASE WHEN i.status = 'pending' AND i.expires_at > (unixepoch('subsec') * 1000) THEN 1 ELSE 0 END,
  i.created_at, coalesce(i.responded_at, i.canceled_at, i.created_at)
FROM interaction i
LEFT JOIN service s ON s.id = i.requester_service_id
LEFT JOIN api_token t ON t.id = i.requester_token_id;--> statement-breakpoint
INSERT INTO `inbox_item` (
  `id`, `user_id`, `entity_type`, `entity_id`, `kind`, `source_name`, `source_image_url`,
  `title`, `body`, `image_url`, `url`, `status`, `result`, `accepted_count`,
  `failed_count`, `needs_action`, `occurred_at`, `updated_at`
)
SELECT
  'ibox:live_activity:' || a.id, a.user_id, 'live_activity', a.id, 'live_activity',
  coalesce(s.title, t.name, 'SHark'), s.image_url,
  coalesce(json_extract(a.props, '$.title'), 'Live Activity'),
  coalesce(json_extract(a.props, '$.detail'), json_extract(a.props, '$.status'), ''),
  NULL, NULL, a.status,
  CASE WHEN a.status = 'ended' THEN 'Completed'
       WHEN a.status = 'expired' THEN 'Expired'
       WHEN a.status = 'failed' THEN 'Failed'
       WHEN a.status IN ('starting', 'active', 'partial') THEN 'Active'
       ELSE a.status END,
  a.accepted_count, a.failed_count, 0, a.created_at, a.updated_at
FROM live_activity a
LEFT JOIN service s ON s.id = a.requester_service_id
LEFT JOIN api_token t ON t.id = a.requester_token_id
WHERE a.interaction_id IS NULL;--> statement-breakpoint
INSERT OR IGNORE INTO `inbox_item_event` (
  `id`, `inbox_item_id`, `dedupe_key`, `kind`, `detail`, `result`,
  `accepted_count`, `failed_count`, `occurred_at`
)
SELECT
  item.id || ':created', item.id, 'created', 'created', item.body, NULL,
  item.accepted_count, item.failed_count, item.occurred_at
FROM inbox_item item;--> statement-breakpoint
INSERT OR IGNORE INTO `inbox_item_event` (
  `id`, `inbox_item_id`, `dedupe_key`, `kind`, `detail`, `result`,
  `accepted_count`, `failed_count`, `occurred_at`
)
SELECT
  'iboxev:operation:' || o.id,
  CASE WHEN a.interaction_id IS NULL
    THEN 'ibox:live_activity:' || a.id
    ELSE 'ibox:interaction:' || a.interaction_id END,
  'operation:' || o.id, 'live_activity_' || o.event,
  coalesce(json_extract(a.props, '$.detail'), json_extract(a.props, '$.status')),
  CASE WHEN o.event = 'start' THEN 'Started'
       WHEN o.event = 'end' THEN 'Completed'
       ELSE 'Updated' END,
  o.accepted_count, o.failed_count, o.created_at
FROM live_activity_operation o
INNER JOIN live_activity a ON a.id = o.activity_id;--> statement-breakpoint
CREATE TRIGGER `inbox_item_created_event`
AFTER INSERT ON `inbox_item`
BEGIN
  INSERT OR IGNORE INTO `inbox_item_event` (
    `id`, `inbox_item_id`, `dedupe_key`, `kind`, `detail`, `result`,
    `accepted_count`, `failed_count`, `occurred_at`
  ) VALUES (
    NEW.id || ':created', NEW.id, 'created', 'created', NEW.body, NULL,
    NEW.accepted_count, NEW.failed_count, NEW.occurred_at
  );
END;--> statement-breakpoint
CREATE TRIGGER `inbox_event_insert`
AFTER INSERT ON `event`
BEGIN
  INSERT INTO `inbox_item` (
    `id`, `user_id`, `entity_type`, `entity_id`, `kind`, `source_name`, `source_image_url`,
    `title`, `body`, `image_url`, `url`, `status`, `result`, `accepted_count`,
    `failed_count`, `needs_action`, `occurred_at`, `updated_at`
  )
  SELECT
    'ibox:event:' || NEW.id, s.user_id, 'event', NEW.id, 'notification',
    s.title, coalesce(NEW.image_url, s.image_url), NEW.title, NEW.body, NEW.image_url, NEW.url,
    NEW.status, NULL, NEW.delivered_count, 0, 0, NEW.created_at, NEW.created_at
  FROM service s WHERE s.id = NEW.service_id
  ON CONFLICT(`entity_type`, `entity_id`) DO NOTHING;
END;--> statement-breakpoint
CREATE TRIGGER `inbox_event_update`
AFTER UPDATE OF `status`, `delivered_count`, `error` ON `event`
BEGIN
  UPDATE `inbox_item` SET
    `status` = NEW.status,
    `result` = CASE WHEN NEW.status IN ('accepted', 'delivered') THEN 'Accepted'
                    WHEN NEW.status = 'partial' THEN 'Partially accepted'
                    WHEN NEW.status = 'no_devices' THEN 'No active devices'
                    WHEN NEW.status = 'failed' THEN coalesce(NEW.error, 'Failed')
                    ELSE NULL END,
    `accepted_count` = NEW.delivered_count,
    `failed_count` = CASE WHEN NEW.status = 'failed' THEN 1 ELSE 0 END,
    `updated_at` = NEW.created_at
  WHERE `entity_type` = 'event' AND `entity_id` = NEW.id;
  INSERT OR IGNORE INTO `inbox_item_event` (
    `id`, `inbox_item_id`, `dedupe_key`, `kind`, `detail`, `result`,
    `accepted_count`, `failed_count`, `occurred_at`
  )
  SELECT
    'iboxev:event:' || NEW.id || ':' || NEW.status,
    CASE WHEN i.id IS NULL THEN 'ibox:event:' || NEW.id ELSE 'ibox:interaction:' || i.id END,
    'delivery:' || NEW.status, 'delivery', NEW.error,
    CASE WHEN NEW.status IN ('accepted', 'delivered') THEN 'Accepted'
         WHEN NEW.status = 'partial' THEN 'Partially accepted'
         WHEN NEW.status = 'no_devices' THEN 'No active devices'
         WHEN NEW.status = 'failed' THEN coalesce(NEW.error, 'Failed')
         ELSE 'Processing' END,
    NEW.delivered_count, CASE WHEN NEW.status = 'failed' THEN 1 ELSE 0 END, NEW.created_at
  FROM (SELECT 1) seed
  LEFT JOIN interaction i ON i.event_id = NEW.id
  WHERE EXISTS (
    SELECT 1 FROM inbox_item item
    WHERE item.id = CASE WHEN i.id IS NULL
      THEN 'ibox:event:' || NEW.id ELSE 'ibox:interaction:' || i.id END
  );
END;--> statement-breakpoint
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
    CASE WHEN NEW.accepted_count > 0 THEN 'accepted' ELSE 'processing' END,
    CASE WHEN NEW.accepted_count > 0 THEN 'Accepted' ELSE NULL END,
    NEW.accepted_count, 0, 0, NEW.created_at, NEW.created_at
  FROM api_token t WHERE t.id = NEW.requester_token_id
  ON CONFLICT(`entity_type`, `entity_id`) DO NOTHING;
END;--> statement-breakpoint
CREATE TRIGGER `inbox_agent_notification_update`
AFTER UPDATE OF `accepted_count` ON `agent_notification`
BEGIN
  UPDATE `inbox_item` SET
    `status` = CASE WHEN NEW.accepted_count > 0 THEN 'accepted' ELSE 'no_devices' END,
    `result` = CASE WHEN NEW.accepted_count > 0 THEN 'Accepted' ELSE 'No active devices' END,
    `accepted_count` = NEW.accepted_count,
    `updated_at` = NEW.created_at
  WHERE `entity_type` = 'agent_notification' AND `entity_id` = NEW.id;
  INSERT OR IGNORE INTO `inbox_item_event` (
    `id`, `inbox_item_id`, `dedupe_key`, `kind`, `detail`, `result`,
    `accepted_count`, `failed_count`, `occurred_at`
  ) VALUES (
    'iboxev:agent_notification:' || NEW.id || ':' || NEW.accepted_count,
    'ibox:agent_notification:' || NEW.id, 'delivery:' || NEW.accepted_count,
    'delivery', NULL,
    CASE WHEN NEW.accepted_count > 0 THEN 'Accepted' ELSE 'No active devices' END,
    NEW.accepted_count, 0, NEW.created_at
  );
END;--> statement-breakpoint
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
    coalesce(s.title, t.name, 'SHark'), coalesce(NEW.image_url, s.image_url),
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
END;--> statement-breakpoint
CREATE TRIGGER `inbox_interaction_update`
AFTER UPDATE OF `status`, `response`, `accepted_count`, `responded_at`, `canceled_at` ON `interaction`
BEGIN
  UPDATE `inbox_item` SET
    `status` = NEW.status,
    `result` = CASE WHEN NEW.status = 'approved' THEN 'Approved'
                    WHEN NEW.status = 'denied' THEN 'Denied'
                    WHEN NEW.status = 'yes' THEN 'Yes'
                    WHEN NEW.status = 'no' THEN 'No'
                    WHEN NEW.status = 'replied' THEN 'Replied'
                    WHEN NEW.status = 'expired' THEN 'Expired'
                    WHEN NEW.status = 'canceled' THEN 'Canceled'
                    ELSE NULL END,
    `accepted_count` = NEW.accepted_count,
    `needs_action` = CASE WHEN NEW.status = 'pending' AND NEW.expires_at > (unixepoch('subsec') * 1000)
      THEN 1 ELSE 0 END,
    `updated_at` = coalesce(NEW.responded_at, NEW.canceled_at, NEW.created_at)
  WHERE `entity_type` = 'interaction' AND `entity_id` = NEW.id;
  INSERT OR IGNORE INTO `inbox_item_event` (
    `id`, `inbox_item_id`, `dedupe_key`, `kind`, `detail`, `result`,
    `accepted_count`, `failed_count`, `occurred_at`
  )
  SELECT
    'iboxev:interaction:' || NEW.id || ':' || coalesce(NEW.responded_at, NEW.canceled_at, NEW.expires_at),
    'ibox:interaction:' || NEW.id, 'terminal:' || NEW.status, 'response', NEW.response,
    CASE WHEN NEW.status = 'approved' THEN 'Approved'
         WHEN NEW.status = 'denied' THEN 'Denied'
         WHEN NEW.status = 'yes' THEN 'Yes'
         WHEN NEW.status = 'no' THEN 'No'
         WHEN NEW.status = 'replied' THEN 'Replied'
         WHEN NEW.status = 'expired' THEN 'Expired'
         WHEN NEW.status = 'canceled' THEN 'Canceled'
         ELSE NEW.status END,
    NEW.accepted_count, 0, coalesce(NEW.responded_at, NEW.canceled_at, NEW.expires_at)
  WHERE NEW.status <> 'pending';
END;--> statement-breakpoint
CREATE TRIGGER `inbox_live_activity_insert`
AFTER INSERT ON `live_activity`
WHEN NEW.interaction_id IS NULL
BEGIN
  INSERT INTO `inbox_item` (
    `id`, `user_id`, `entity_type`, `entity_id`, `kind`, `source_name`, `source_image_url`,
    `title`, `body`, `image_url`, `url`, `status`, `result`, `accepted_count`,
    `failed_count`, `needs_action`, `occurred_at`, `updated_at`
  )
  SELECT
    'ibox:live_activity:' || NEW.id, NEW.user_id, 'live_activity', NEW.id, 'live_activity',
    coalesce(s.title, t.name, 'SHark'), s.image_url,
    coalesce(json_extract(NEW.props, '$.title'), 'Live Activity'),
    coalesce(json_extract(NEW.props, '$.detail'), json_extract(NEW.props, '$.status'), ''),
    NULL, NULL, NEW.status, 'Active', NEW.accepted_count, NEW.failed_count, 0,
    NEW.created_at, NEW.updated_at
  FROM (SELECT 1) seed
  LEFT JOIN service s ON s.id = NEW.requester_service_id
  LEFT JOIN api_token t ON t.id = NEW.requester_token_id
  WHERE true
  ON CONFLICT(`entity_type`, `entity_id`) DO NOTHING;
END;--> statement-breakpoint
CREATE TRIGGER `inbox_live_activity_update`
AFTER UPDATE OF `props`, `status`, `accepted_count`, `failed_count`, `updated_at` ON `live_activity`
WHEN NEW.interaction_id IS NULL
BEGIN
  UPDATE `inbox_item` SET
    `title` = coalesce(json_extract(NEW.props, '$.title'), 'Live Activity'),
    `body` = coalesce(json_extract(NEW.props, '$.detail'), json_extract(NEW.props, '$.status'), ''),
    `status` = NEW.status,
    `result` = CASE WHEN NEW.status = 'ended' THEN 'Completed'
                    WHEN NEW.status = 'expired' THEN 'Expired'
                    WHEN NEW.status = 'failed' THEN 'Failed'
                    ELSE 'Active' END,
    `accepted_count` = NEW.accepted_count,
    `failed_count` = NEW.failed_count,
    `updated_at` = NEW.updated_at
  WHERE `entity_type` = 'live_activity' AND `entity_id` = NEW.id;
END;--> statement-breakpoint
CREATE TRIGGER `inbox_live_activity_operation_insert`
AFTER INSERT ON `live_activity_operation`
BEGIN
  INSERT OR IGNORE INTO `inbox_item_event` (
    `id`, `inbox_item_id`, `dedupe_key`, `kind`, `detail`, `result`,
    `accepted_count`, `failed_count`, `occurred_at`
  )
  SELECT
    'iboxev:operation:' || NEW.id,
    CASE WHEN a.interaction_id IS NULL
      THEN 'ibox:live_activity:' || a.id
      ELSE 'ibox:interaction:' || a.interaction_id END,
    'operation:' || NEW.id, 'live_activity_' || NEW.event,
    coalesce(json_extract(a.props, '$.detail'), json_extract(a.props, '$.status')),
    CASE WHEN NEW.event = 'start' THEN 'Started'
         WHEN NEW.event = 'end' THEN 'Completed'
         ELSE 'Updated' END,
    NEW.accepted_count, NEW.failed_count, NEW.created_at
  FROM live_activity a WHERE a.id = NEW.activity_id;
END;--> statement-breakpoint
CREATE TRIGGER `inbox_live_activity_attempt_insert`
AFTER INSERT ON `live_activity_delivery_attempt`
BEGIN
  INSERT OR IGNORE INTO `inbox_item_event` (
    `id`, `inbox_item_id`, `dedupe_key`, `kind`, `detail`, `result`,
    `accepted_count`, `failed_count`, `occurred_at`
  )
  SELECT
    'iboxev:attempt:' || NEW.id,
    CASE WHEN a.interaction_id IS NULL
      THEN 'ibox:live_activity:' || a.id
      ELSE 'ibox:interaction:' || a.interaction_id END,
    'attempt:' || NEW.id, 'delivery_attempt', NEW.apns_reason,
    CASE WHEN NEW.apns_status BETWEEN 200 AND 299 THEN 'Accepted'
         ELSE coalesce(NEW.apns_reason, 'Failed') END,
    CASE WHEN NEW.apns_status BETWEEN 200 AND 299 THEN 1 ELSE 0 END,
    CASE WHEN NEW.apns_status BETWEEN 200 AND 299 THEN 0 ELSE 1 END,
    NEW.created_at
  FROM live_activity a WHERE a.id = NEW.activity_id;
END;
