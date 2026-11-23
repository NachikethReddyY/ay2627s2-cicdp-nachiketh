CREATE TABLE "ai_call_spend" (
	"day" date DEFAULT (now() AT TIME ZONE 'UTC')::date NOT NULL,
	"prompt_tokens" integer NOT NULL,
	"completion_tokens" integer NOT NULL,
	"estimated_usd" numeric(24, 12),
	CONSTRAINT "ai_call_spend_nonnegative" CHECK ("ai_call_spend"."prompt_tokens" >= 0 AND "ai_call_spend"."completion_tokens" >= 0 AND "ai_call_spend"."estimated_usd" >= 0)
);
--> statement-breakpoint
CREATE INDEX "ai_call_spend_day_idx" ON "ai_call_spend" USING btree ("day");