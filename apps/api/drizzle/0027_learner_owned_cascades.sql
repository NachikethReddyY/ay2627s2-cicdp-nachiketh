ALTER TABLE "attempts" DROP CONSTRAINT "attempts_learner_id_learners_id_fk";
--> statement-breakpoint
ALTER TABLE "game_completions" DROP CONSTRAINT IF EXISTS "game_completions_learner_id_learners_id_fk";
--> statement-breakpoint
ALTER TABLE "game_completions" DROP CONSTRAINT IF EXISTS "game_completions_learner_id_fkey";
--> statement-breakpoint
ALTER TABLE "hint_events" DROP CONSTRAINT "hint_events_learner_id_learners_id_fk";
--> statement-breakpoint
ALTER TABLE "step_progress" DROP CONSTRAINT "step_progress_learner_id_learners_id_fk";
--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_completions" ADD CONSTRAINT "game_completions_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hint_events" ADD CONSTRAINT "hint_events_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_progress" ADD CONSTRAINT "step_progress_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;
