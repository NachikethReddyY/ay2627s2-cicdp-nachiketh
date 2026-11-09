CREATE TABLE "import_job_events" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"created_by" text NOT NULL,
	"repo" text NOT NULL,
	"sha" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"lesson_id" text,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_job_events" ADD CONSTRAINT "import_job_events_job_id_import_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_created_by_learners_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "import_job_events_job_seq" ON "import_job_events" USING btree ("job_id","seq");--> statement-breakpoint
CREATE INDEX "import_jobs_creator" ON "import_jobs" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "import_jobs_lesson" ON "import_jobs" USING btree ("lesson_id");