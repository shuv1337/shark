ALTER TABLE `oncall_page_recipient` ADD `delivery_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
UPDATE `oncall_page_recipient` SET `delivery_status` = CASE WHEN `accepted_count` > 0 THEN 'delivered' ELSE 'failed' END;--> statement-breakpoint
CREATE INDEX `oncall_page_recipient_delivery_idx` ON `oncall_page_recipient` (`delivery_status`,`notified_at`);
