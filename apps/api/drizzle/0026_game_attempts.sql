CREATE TABLE "game_attempts" (
	"learner_id" text NOT NULL,
	"lesson_version_id" text NOT NULL,
	"block_id" text NOT NULL,
	"attempt_day" date NOT NULL,
	"misses" integer NOT NULL,
	"hints_revealed" integer NOT NULL,
	CONSTRAINT "game_attempts_learner_id_lesson_version_id_block_id_pk" PRIMARY KEY("learner_id","lesson_version_id","block_id")
);
--> statement-breakpoint
ALTER TABLE "game_attempts" ADD CONSTRAINT "game_attempts_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_attempts" ADD CONSTRAINT "game_attempts_lesson_version_id_lesson_versions_id_fk" FOREIGN KEY ("lesson_version_id") REFERENCES "public"."lesson_versions"("id") ON DELETE cascade ON UPDATE no action;