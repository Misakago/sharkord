ALTER TABLE `messages` ADD `message_id` text;--> statement-breakpoint
UPDATE `messages` SET `message_id` = 'm_' || lower(hex(randomblob(6))) WHERE `message_id` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `messages_message_id_idx` ON `messages` (`message_id`);
