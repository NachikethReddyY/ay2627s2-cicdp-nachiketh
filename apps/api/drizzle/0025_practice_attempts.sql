CREATE TABLE "practice_attempts" (
	"learner_id" text NOT NULL,
	"lesson_version_id" text NOT NULL,
	"content_key" text NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "practice_attempts_learner_id_lesson_version_id_content_key_pk" PRIMARY KEY("learner_id","lesson_version_id","content_key")
);
--> statement-breakpoint
ALTER TABLE "practice_attempts" ADD CONSTRAINT "practice_attempts_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_attempts" ADD CONSTRAINT "practice_attempts_lesson_version_id_lesson_versions_id_fk" FOREIGN KEY ("lesson_version_id") REFERENCES "public"."lesson_versions"("id") ON DELETE cascade ON UPDATE no action;