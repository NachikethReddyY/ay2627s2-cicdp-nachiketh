CREATE TABLE "spend_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"amount_usd" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
