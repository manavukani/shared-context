CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`repo_path` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`source` text,
	`content_hash` text NOT NULL,
	`embedding` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memories_project_kind_hash` ON `memories` (`project_id`,`kind`,`content_hash`);
--> statement-breakpoint
CREATE TABLE `current_work` (
	`project_id` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`source` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`)
);
--> statement-breakpoint
CREATE TABLE `standup_items` (
	`project_id` text PRIMARY KEY NOT NULL,
	`sentence` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`)
);
--> statement-breakpoint
CREATE TABLE `operation_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`operation` text NOT NULL,
	`project_id` text,
	`detail` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_meta` (
	`rel_path` text PRIMARY KEY NOT NULL,
	`file_hash` text NOT NULL,
	`db_hash` text NOT NULL,
	`updated_at` integer NOT NULL
);
