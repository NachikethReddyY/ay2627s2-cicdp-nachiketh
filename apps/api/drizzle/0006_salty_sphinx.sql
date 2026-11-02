CREATE TABLE "lesson_media" (
	"id" text PRIMARY KEY NOT NULL,
	"lesson_version_id" text NOT NULL,
	"step_id" text,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"content_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_media_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "lesson_media" ADD CONSTRAINT "lesson_media_lesson_version_id_lesson_versions_id_fk" FOREIGN KEY ("lesson_version_id") REFERENCES "public"."lesson_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_media" ADD CONSTRAINT "lesson_media_step_id_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lesson_media_version" ON "lesson_media" USING btree ("lesson_version_id");