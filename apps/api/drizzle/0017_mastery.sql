CREATE TABLE "mastery" (
	"learner_id" text NOT NULL,
	"concept_id" text NOT NULL,
	"p_known" real NOT NULL,
	"n_obs" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mastery_learner_id_concept_id_pk" PRIMARY KEY("learner_id","concept_id")
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" text PRIMARY KEY NOT NULL,
	"learner_id" text NOT NULL,
	"world_id" text NOT NULL,
	"lesson_id" text,
	"concept_id" text,
	"action" text NOT NULL,
	"reason_code" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "recommendations_action_check" CHECK ("recommendations"."action" IN ('start','learn','practice','advance','done'))
);
--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "mastery_applied_at" timestamp;--> statement-breakpoint
ALTER TABLE "mastery" ADD CONSTRAINT "mastery_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mastery" ADD CONSTRAINT "mastery_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recommendations_learner_world_time" ON "recommendations" USING btree ("learner_id","world_id","created_at" DESC NULLS LAST);