ALTER TABLE "learners" ALTER COLUMN "leaderboard_opt_in" SET DEFAULT true;
--> statement-breakpoint
UPDATE "learners" SET "leaderboard_opt_in" = true WHERE "leaderboard_opt_in" = false;
