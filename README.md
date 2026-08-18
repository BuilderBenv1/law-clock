# ניהול שעות ומשרד · Law-Firm Time & Billing

A focused hours-tracking and billing app for a law office, built around the way
Cake structures work — **Client → Case (project) → Task** — but trimmed to what a
small firm actually needs, with **Hebrew reports** built in.

It replaces the parts of a heavier tool you use every day:

- **One-click timer with pause and resume.** Start work, pause it, pick it up
  again days later — the dashboard lists what you were doing so resuming is a
  single click. Pauses are real: each sitting is stored separately, and the gaps
  between them appear on the client's statement.
- **Nothing to set up before you start.** Type a client that does not exist yet
  and it is created; same for a case. Every client also gets a **general** case,
  so uncategorised work needs no case at all. The "what are you working on" box
  remembers what you have typed for that client and offers it back.
- **Statements and invoices as real, downloadable PDFs** — properly typeset
  right-to-left Hebrew, not a browser print-out. A statement opens with the fee,
  the hours and the total, then breaks down by case, then by task within each
  case, then a dated activity log showing every sitting and every break.
- **Reports for any period, or all time** — on screen with pie charts of where
  the time went, exported to CSV (Excel keeps the Hebrew), or downloaded as PDF.
- **Automatic monthly report** emailed to an address you set.
- **Alerts the client asked for**: per case *and* across the whole client, on
  **hours or money**. When the limit is reached the client is emailed once —
  "you asked to be told when this reached ₪10,000; here is that reminder".
- **Billable and non-billable time.** Mark any session as non-billable and it is
  tracked, shown, and excluded from invoices and totals.
- **Firm logo & case numbers** on every document; cases carry a number, a name,
  or both.

Everything is **RTL Hebrew by default** (switchable to English in Settings).

### Actual hours vs billed hours

Reports show both, and they are deliberately different. Billing rounds **each
sitting** up to one billing unit (6 minutes by default, the legal convention), so
three two-minute calls bill 0.3h rather than 0.1h. Set the unit to `1` in
Settings if you would rather bill the raw minutes. Every screen and document that
shows the two numbers also explains the gap.

## How it maps to the requirements

| You asked for | Where it lives |
|---|---|
| Open a timer when I start, close it when I finish | Dashboard timer widget → `startTimer` / `pauseTimer` |
| Pause and resume work easily | Pause button + "resume work" list → `resumeTask` |
| Add a client / case from the dropdown | `__new__` option in the timer → `resolveClientId` / `resolveProjectId` |
| Previous tasks as a picker | `components/combobox.tsx`, fed by `getClientsTree().taskNames` |
| Uncategorised work | auto-created default case → `ensureDefaultCase` |
| Show pause gaps to the client | `ReportSession.gapMsBefore` → statement activity log |
| Downloadable PDF | `/api/reports/pdf`, `/api/invoices/[id]/pdf` |
| Pie charts of time spent | `components/pie-chart.tsx` on `/reports` |
| Alert on hours **or** shekels | `alertThreshold{Hours,Amount}` on cases and clients → `checkAlerts` |
| Unbilled hours | `time_entries.billable` |
| All-time reports | `allTime` flag through `buildReport` |
| Export hours per case of a client | `/reports` → CSV / print, or per-case buttons |
| Reports in Hebrew | RTL report page + CSV with UTF-8 BOM; Hebrew emails |
| Send a report to a set email every month | Vercel cron → `/api/cron/monthly` → configured `reportEmail` |
| Alert at X hours in a case → inform client | Per-case `alertThresholdHours` → email to the client |
| Client · project · task structure | `clients` → `projects` (cases) → `tasks` |
| One-off invoices (like the Claude version) | `/invoices/new` — tracked hours and/or flat charges |
| Attach case numbers + logo | `projects.caseNumber`, `settings.logoUrl`, snapshotted onto invoices |

## Stack

Next.js 15 (App Router) · Drizzle ORM + Neon Postgres · Auth.js (Google, email
allowlist) · Resend (email) · Tailwind. Deploys to Vercel; the monthly report
runs on a daily Vercel Cron that fires once per new month.

## Data model

```
clients ──< projects (cases) ──< tasks
   └──────────< time_entries >───────┘   (denormalized client + project ids)
```

- A **time_entry** with `end_ms = NULL` is a running timer (a partial unique
  index allows only one at a time).
- **Billable hours** round each entry up to `round_increment_min` (default 6 min,
  the legal convention). Reports show both raw and billable hours.
- Rate resolution: case rate → client rate → firm default.

## Upgrading an existing deployment

This version adds columns. Run **`drizzle/APPLY-TO-LIVE-DB.sql`** once in the Neon
SQL editor before (or right after) deploying — it is idempotent, and it also
back-fills the general case for clients that already exist.

Fresh databases can just use `npm run db:migrate`.

## Checks

Two of these run real code against a real Postgres (pglite, in-process) rather
than mocking it, because the risky parts are hand-written SQL and multi-write
actions that TypeScript cannot verify:

```bash
npm run typecheck
npm run check:bidi                       # PDF text direction (no extra deps)
npm i --no-save @electric-sql/pglite
npm run check:queries                    # migrations + query layer
npm run check:actions                    # start / pause / resume / manual entry
```

`check:bidi` guards a genuinely counter-intuitive invariant: `shape()` must *not*
return visual order, because fontkit already reverses Hebrew runs when pdf-lib
lays them out. See the comment in `lib/pdf/bidi.ts`.

## Local development

```bash
npm install
npm run lawfirm            # from repo root — starts the dev server
# or, inside apps/lawfirm:
npm run dev
```

Copy `.env.example` to `.env` and fill it in (see **Setup** below). Run the
migration once against your database:

```bash
npm run db:migrate        # applies drizzle/ to DATABASE_URL
```

## Setup (deploy)

1. **Database** — create a Neon Postgres (e.g. via the Vercel Marketplace) and set
   `DATABASE_URL`. Run `npm run db:migrate`.
2. **Auth** — create a Google OAuth client; set `AUTH_SECRET`, `AUTH_GOOGLE_ID`,
   `AUTH_GOOGLE_SECRET`, and `OWNER_EMAIL` (comma-separated allowlist).
3. **Email** — add a Resend API key (`RESEND_API_KEY`) and a verified
   `EMAIL_FROM`. Set the recipient for monthly reports in **Settings → report
   email**.
4. **Cron** — set `CRON_SECRET`; `vercel.json` already schedules
   `/api/cron/monthly` daily. It sends the previous month's report on the first
   run of each new month (deduped via `last_monthly_sent_key`).

## Notes on Hebrew PDFs

Statements and invoices are generated as real PDFs with `pdf-lib`, embedding
**Assistant** (SIL OFL, in `assets/`, inlined as base64 so serverless bundling
always includes it). Hebrew needs two things Latin does not:

1. **Direction.** fontkit already reverses Hebrew runs, but it reverses embedded
   numbers and Latin with them — `12,` would print as `,21`. `lib/pdf/bidi.ts`
   pre-flips only the left-to-right islands and mirrors brackets, so fontkit's
   own reversal lands everything the right way round. `npm run check:bidi` locks
   this in.
2. **Layout.** `lib/pdf/doc.ts` is a small right-to-left-aware layout engine
   (columns laid out from the reading edge, numerics hugging the far edge, page
   breaks, repeating table headers, footers) so the document code describes the
   page instead of doing arithmetic.

CSV exports carry a UTF-8 BOM so Excel shows Hebrew correctly. The browser print
view is still there for anyone who prefers it.

## Common commands

```bash
npm run dev            # local dashboard
npm run build          # production build
npm run typecheck      # tsc --noEmit
npm run db:generate    # regenerate migrations from schema
npm run db:migrate     # apply migrations
```

## Defaults (editable in Settings)

Currency **ILS (₪)** · billing increment **6 min** · timezone **Asia/Jerusalem** ·
language **Hebrew**.
