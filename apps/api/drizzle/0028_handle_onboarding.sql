ALTER TABLE "learners" ALTER COLUMN "handle" SET DEFAULT 'learner_' || left(replace(gen_random_uuid()::text, '-', ''), 10);--> statement-breakpoint
ALTER TABLE "learners" ADD COLUMN "handle_updated_at" timestamp with time zone;--> statement-breakpoint
UPDATE "learners" SET "handle" = replace("handle", '-', '_') WHERE "handle" ~ '^learner-[0-9a-f]{10}$';
