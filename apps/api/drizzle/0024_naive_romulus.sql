ALTER TABLE "learners" ADD COLUMN "handle" text;--> statement-breakpoint
UPDATE "learners" SET "handle" = 'learner-' || substr(replace("id", '-', ''), 1, 10) WHERE "handle" IS NULL;--> statement-breakpoint
ALTER TABLE "learners" ALTER COLUMN "handle" SET DEFAULT 'learner-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);--> statement-breakpoint
ALTER TABLE "learners" ALTER COLUMN "handle" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "learners_handle_idx" ON "learners" USING btree ("handle");
