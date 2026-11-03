CREATE TABLE "game_completions" (
	"learner_id" text NOT NULL REFERENCES "learners"("id"),
	"lesson_id" text NOT NULL REFERENCES "lessons"("id"),
	"part_idx" integer NOT NULL,
	"block_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "game_completions_learner_id_lesson_id_part_idx_block_id_pk" PRIMARY KEY("learner_id", "lesson_id", "part_idx", "block_id")
);
