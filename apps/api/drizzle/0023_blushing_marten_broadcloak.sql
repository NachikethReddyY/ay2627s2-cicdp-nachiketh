DROP INDEX "lesson_media_one_narration";--> statement-breakpoint
ALTER TABLE "lesson_media" ADD COLUMN "segment" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_media_one_narration" ON "lesson_media" USING btree ("lesson_version_id",coalesce("step_id", ''),coalesce("segment", -1)) WHERE "lesson_media"."kind" = 'narration' AND "lesson_media"."status" = 'ready';