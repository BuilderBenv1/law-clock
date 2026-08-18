ALTER TABLE "clients" ADD COLUMN "alert_threshold_hours" double precision;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "alert_threshold_amount" double precision;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "alert_notified_hours" double precision;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "alert_notified_amount" double precision;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "alert_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "alert_threshold_amount" double precision;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "alert_notified_amount" double precision;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "is_default" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "billable" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX "entry_task_idx" ON "time_entries" USING btree ("task_id");