ALTER TABLE "lesson_versions" ADD COLUMN "content" jsonb;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "kind" text DEFAULT 'predict' NOT NULL;