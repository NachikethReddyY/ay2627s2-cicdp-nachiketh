CREATE TABLE "feedback_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"location" text,
	"details" text NOT NULL,
	"screenshot_key" text,
	"submission_hash" text NOT NULL,
	"received" boolean NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "feedback_reports_received_created" ON "feedback_reports" USING btree ("created_at","id") WHERE "feedback_reports"."received";