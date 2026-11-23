CREATE TABLE "lesson_observations" (
	"id" text PRIMARY KEY NOT NULL,
	"learner_id" text NOT NULL,
	"lesson_version_id" text NOT NULL,
	"activity_key" text NOT NULL,
	"kind" text NOT NULL,
	"option_count" integer,
	"correct" boolean NOT NULL,
	"hints_used" integer DEFAULT 0 NOT NULL,
	"mastery_applied_at" timestamp,
	"mastery_retry_at" timestamp,
	"mastery_failures" integer DEFAULT 0 NOT NULL,
	"mastery_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "mastery_retry_at" timestamp;--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "mastery_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "mastery_error" text;--> statement-breakpoint
ALTER TABLE "lesson_observations" ADD CONSTRAINT "lesson_observations_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_observations" ADD CONSTRAINT "lesson_observations_lesson_version_id_lesson_versions_id_fk" FOREIGN KEY ("lesson_version_id") REFERENCES "public"."lesson_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_observations_first_try" ON "lesson_observations" USING btree ("learner_id","lesson_version_id","activity_key");