CREATE TABLE "path_build_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"path_id" text NOT NULL,
	"learner_id" text NOT NULL,
	"lesson_id" text,
	"topic" text,
	"checkpoint" jsonb,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"lease_token" text,
	CONSTRAINT "path_build_jobs_kind" CHECK (("path_build_jobs"."lesson_id" IS NULL) <> ("path_build_jobs"."topic" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "objective" text;--> statement-breakpoint
ALTER TABLE "paths" ADD COLUMN "roadmap" jsonb;--> statement-breakpoint
ALTER TABLE "path_build_jobs" ADD CONSTRAINT "path_build_jobs_path_id_paths_id_fk" FOREIGN KEY ("path_id") REFERENCES "public"."paths"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "path_build_jobs" ADD CONSTRAINT "path_build_jobs_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "path_build_jobs" ADD CONSTRAINT "path_build_jobs_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "path_build_jobs_path" ON "path_build_jobs" USING btree ("path_id");--> statement-breakpoint
CREATE INDEX "path_build_jobs_queue" ON "path_build_jobs" USING btree ("state","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "path_build_jobs_lesson" ON "path_build_jobs" USING btree ("lesson_id");--> statement-breakpoint
CREATE UNIQUE INDEX "path_build_jobs_plan" ON "path_build_jobs" USING btree ("path_id") WHERE "path_build_jobs"."lesson_id" IS NULL;