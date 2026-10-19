ALTER TABLE `oncall_page_recipient` ADD `delivery_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `oncall_page_recipient` ADD `delivery_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `oncall_page_recipient` ADD `next_attempt_at` integer;--> statement-breakpoint
UPDATE `oncall_page_recipient` SET
  `delivery_status` = CASE WHEN `accepted_count` > 0 THEN 'delivered' ELSE 'failed' END,
  `delivery_attempts` = 1;--> statement-breakpoint
UPDATE `oncall_page_recipient`
SET `next_attempt_at` = CAST(unixepoch('subsec') * 1000 AS INTEGER) + 60000 + abs(random() % 300000)
WHERE `delivery_status` = 'failed'
  AND `page_id` IN (
    SELECT `id` FROM `oncall_page`
    WHERE `status` = 'triggered'
      AND `created_at` >= CAST(unixepoch('subsec') * 1000 AS INTEGER) - 86400000
  );--> statement-breakpoint
CREATE INDEX `oncall_page_recipient_delivery_idx` ON `oncall_page_recipient` (`delivery_status`,`next_attempt_at`);
