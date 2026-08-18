CREATE TABLE "entry_segments" (
	"id" serial PRIMARY KEY NOT NULL,
	"entry_id" text NOT NULL,
	"start_ms" bigint NOT NULL,
	"end_ms" bigint
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "alert_threshold_amount" double precision;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "alert_notified_amount" double precision;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "alert_amount_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "is_default" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "status" text DEFAULT 'stopped' NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "billable" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "entry_segments" ADD CONSTRAINT "entry_segments_entry_id_time_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."time_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "segment_entry_idx" ON "entry_segments" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "entry_status_idx" ON "time_entries" USING btree ("status");--> statement-breakpoint

-- Existing rows predate pause/resume: an open end_ms meant "running", otherwise done.
UPDATE "time_entries" SET "status" = CASE WHEN "end_ms" IS NULL THEN 'running' ELSE 'stopped' END;--> statement-breakpoint

-- Give every existing entry the single segment it implicitly had, so historic
-- work still totals correctly under the segment-based duration model.
INSERT INTO "entry_segments" ("entry_id", "start_ms", "end_ms")
SELECT "id", "start_ms", "end_ms" FROM "time_entries";--> statement-breakpoint

-- The old guard keyed on "end_ms IS NULL", which now also matches paused work
-- and would stop a paused entry coexisting with a running one. Key it on status.
DROP INDEX IF EXISTS "one_running_timer";--> statement-breakpoint
CREATE UNIQUE INDEX "one_running_timer" ON "time_entries" ((1)) WHERE "status" = 'running';--> statement-breakpoint

-- Backfill a catch-all case per client, so work can be tracked without picking one.
INSERT INTO "projects" ("id", "client_id", "name", "status", "is_default", "created_at")
SELECT substr(md5(random()::text || c."id"), 1, 20), c."id", 'עבודה כללית', 'open', 1, now()
FROM "clients" c
WHERE NOT EXISTS (SELECT 1 FROM "projects" p WHERE p."client_id" = c."id" AND p."is_default" = 1);