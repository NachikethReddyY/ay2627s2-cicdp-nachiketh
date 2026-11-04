CREATE TABLE "generation_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
