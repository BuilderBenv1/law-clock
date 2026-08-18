-- Run this once against the live database (Neon SQL editor) before deploying
-- this version. Safe to run more than once: every statement is idempotent.
--
-- The live database was created by pasting SQL rather than by `db:migrate`, so
-- it has no drizzle migration journal. This file is the same change as
-- drizzle/0002_pause_resume_billable_alerts.sql, written to be re-runnable.

-- Time can now be tracked without being charged (pro-bono, internal, written off).
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "billable" integer DEFAULT 1 NOT NULL;

-- Cases: alert on money as well as hours, and mark the catch-all case.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "alert_threshold_amount" double precision;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "alert_notified_amount" double precision;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "is_default" integer DEFAULT 0 NOT NULL;

-- Clients: the same two alerts, accumulated across every case.
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "alert_threshold_hours" double precision;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "alert_threshold_amount" double precision;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "alert_notified_hours" double precision;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "alert_notified_amount" double precision;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "alert_notified_at" timestamp with time zone;

-- Resuming work looks sessions up by task.
CREATE INDEX IF NOT EXISTS "entry_task_idx" ON "time_entries" USING btree ("task_id");

-- Give every existing client a catch-all case, so uncategorised work can be
-- logged straight away. Clients created from now on get one automatically.
INSERT INTO "projects" ("id", "client_id", "name", "description", "is_default", "status", "archived")
SELECT
  substr(md5(random()::text || c.id), 1, 20),
  c.id,
  'כללי',
  'עבודה שאינה משויכת לתיק',
  1,
  'open',
  0
FROM "clients" c
WHERE NOT EXISTS (
  SELECT 1 FROM "projects" p WHERE p.client_id = c.id AND p.is_default = 1
);
