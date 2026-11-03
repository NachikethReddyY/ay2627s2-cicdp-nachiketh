CREATE TABLE "image_generations" (
	"id" text PRIMARY KEY NOT NULL,
	"learner_id" text NOT NULL,
	"prompt_hash" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "image_generations" ADD CONSTRAINT "image_generations_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "image_generations_learner_time" ON "image_generations" USING btree ("learner_id","created_at");