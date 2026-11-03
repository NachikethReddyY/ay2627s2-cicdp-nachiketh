ALTER TABLE "lesson_media" ALTER COLUMN "key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson_media" ADD COLUMN "status" text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson_media" ADD COLUMN "prompt_hash" text;--> statement-breakpoint
ALTER TABLE "lesson_media" ADD CONSTRAINT "lesson_media_prompt_hash_unique" UNIQUE("prompt_hash");
