CREATE TABLE "check_results" (
	"learner_id" text NOT NULL,
	"lesson_id" text NOT NULL,
	"best_points" integer NOT NULL,
	"max_points" integer NOT NULL,
	"complete" boolean NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "check_results_learner_id_lesson_id_pk" PRIMARY KEY("learner_id","lesson_id")
);
--> statement-breakpoint
ALTER TABLE "check_results" ADD CONSTRAINT "check_results_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_results" ADD CONSTRAINT "check_results_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;