ALTER TABLE `oncall_override` ADD `created_by_user_id` text REFERENCES user(id) ON UPDATE no action ON DELETE set null;
