CREATE TABLE "app_users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "portal_token" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "vat_rate" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "vat_amount" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "total" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "retainer_amount" double precision;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "retainer_hours" double precision;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "hearing_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "vat_rate" double precision DEFAULT 18 NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "user_email" text;--> statement-breakpoint
CREATE UNIQUE INDEX "client_portal_token_idx" ON "clients" USING btree ("portal_token");--> statement-breakpoint

-- Legacy invoices predate VAT: their total is simply the subtotal.
UPDATE "invoices" SET "total" = "subtotal" WHERE "total" = 0;
