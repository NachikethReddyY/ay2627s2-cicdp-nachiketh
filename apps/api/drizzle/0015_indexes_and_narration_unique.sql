-- Dedupe first: the old index let several lesson-level (step_id IS NULL) narration rows coexist. Keep the oldest.
DELETE FROM "lesson_media" m USING "lesson_media" k
WHERE m."kind" = 'narration' AND m."status" = 'ready' AND k."kind" = 'narration' AND k."status" = 'ready'
  AND m."lesson_version_id" = k."lesson_version_id"
  AND coalesce(m."step_id", '') = coalesce(k."step_id", '')
  AND (k."created_at", k."id") < (m."created_at", m."id");--> statement-breakpoint
DROP INDEX "lesson_media_one_narration";--> statement-breakpoint
CREATE INDEX "attempts_learner_time" ON "attempts" USING btree ("learner_id","created_at");--> statement-breakpoint
CREATE INDEX "enrollments_path" ON "enrollments" USING btree ("path_id");--> statement-breakpoint
CREATE INDEX "lessons_world_order" ON "lessons" USING btree ("world_id","level","position");--> statement-breakpoint
CREATE INDEX "path_courses_world" ON "path_courses" USING btree ("world_id");--> statement-breakpoint
CREATE INDEX "paths_owner" ON "paths" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "worlds_owner" ON "worlds" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_media_one_narration" ON "lesson_media" USING btree ("lesson_version_id",coalesce("step_id", '')) WHERE "lesson_media"."kind" = 'narration' AND "lesson_media"."status" = 'ready';