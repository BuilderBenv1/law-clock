import {
  pgTable,
  text,
  integer,
  bigint,
  doublePrecision,
  timestamp,
  serial,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * Data model mirrors the way a lawyer thinks about their work — and the way
 * Cake structures it: Client → Project (a case/matter) → Task. Every timer
 * (a `time_entry`) is booked against a task, so hours roll up cleanly into a
 * case total and then a client total.
 */

/** A firm client. `hourlyRate` is the default; a case may override it. */
export const clients = pgTable(
  'clients',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),
    address: text('address'),
    hourlyRate: doublePrecision('hourly_rate').notNull().default(0),
    currency: text('currency').notNull().default('ILS'),
    notes: text('notes'),
    /** Secret for the client's read-only portal link; null = portal disabled. */
    portalToken: text('portal_token'),
    archived: integer('archived').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    nameIdx: index('client_name_idx').on(t.name),
    portalIdx: uniqueIndex('client_portal_token_idx').on(t.portalToken),
  }),
);

/**
 * A case / matter (Cake calls it a "project"). Belongs to a client. Carries an
 * optional rate override and an optional hours-alert threshold: when logged
 * hours reach `alertThresholdHours`, the client is notified automatically.
 * `alertNotifiedHours` records the threshold value we already fired on, so the
 * same alert never repeats until the threshold is raised.
 */
export const projects = pgTable(
  'projects',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Firm's case/matter number (e.g. "2026-0143"); optional, shown with the name. */
    caseNumber: text('case_number'),
    description: text('description'),
    status: text('status').notNull().default('open'), // 'open' | 'closed'
    /** Per-case hourly rate override; null = use the client's rate. */
    hourlyRate: doublePrecision('hourly_rate'),
    /** Notify the client once logged hours reach this many; null = no alert. */
    alertThresholdHours: doublePrecision('alert_threshold_hours'),
    /** The threshold value already alerted on (dedupe guard); null = not yet. */
    alertNotifiedHours: doublePrecision('alert_notified_hours'),
    alertNotifiedAt: timestamp('alert_notified_at', { withTimezone: true }),
    /** Notify the client once billed value reaches this amount; null = no alert. */
    alertThresholdAmount: doublePrecision('alert_threshold_amount'),
    /** The amount threshold already alerted on (dedupe guard). */
    alertNotifiedAmount: doublePrecision('alert_notified_amount'),
    alertAmountNotifiedAt: timestamp('alert_amount_notified_at', { withTimezone: true }),
    /** Prepaid budget for the case, in the client's currency; null = none. */
    retainerAmount: doublePrecision('retainer_amount'),
    /** Prepaid hours for the case; null = none. Either or both may be set. */
    retainerHours: doublePrecision('retainer_hours'),
    /** Next court hearing on this case; null = none scheduled. */
    hearingDate: timestamp('hearing_date', { withTimezone: true }),
    /**
     * The client's catch-all case, auto-created with the client. Work can be
     * tracked without choosing a case, and lands here.
     */
    isDefault: integer('is_default').notNull().default(0),
    archived: integer('archived').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => ({ clientIdx: index('project_client_idx').on(t.clientId) }),
);

/** A task within a case — the finest-grained bucket a timer is booked against. */
export const tasks = pgTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    archived: integer('archived').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ projectIdx: index('task_project_idx').on(t.projectId) }),
);

/**
 * One piece of billable work on a case — a "task session". It can be worked in
 * several sittings: each sitting is a row in `entrySegments`, so pausing and
 * resuming does not fragment the work. `durationMs` is the sum of the segments,
 * and billing rounding is applied once to that total (rounding each fragment
 * would over-bill every pause). Client and project are denormalized so hours
 * aggregate without joins and survive a task rename.
 */
export const timeEntries = pgTable(
  'time_entries',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    taskId: text('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    description: text('description'),
    startMs: bigint('start_ms', { mode: 'number' }).notNull(),
    /** NULL until the work is finished for good (running or paused). */
    endMs: bigint('end_ms', { mode: 'number' }),
    /** Total worked ms across all segments, excluding paused gaps. */
    durationMs: bigint('duration_ms', { mode: 'number' }),
    /** 'running' (clock ticking) | 'paused' (resumable) | 'stopped' (done). */
    status: text('status').notNull().default('stopped'),
    /** 0 = logged but not charged (pro bono, write-off, internal). */
    billable: integer('billable').notNull().default(1),
    /** Email of the signed-in user who logged this; null on legacy rows. */
    userEmail: text('user_email'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    clientIdx: index('entry_client_idx').on(t.clientId),
    projectIdx: index('entry_project_idx').on(t.projectId),
    startIdx: index('entry_start_idx').on(t.startMs),
    statusIdx: index('entry_status_idx').on(t.status),
  }),
);

/**
 * One continuous sitting within a task session. Closing a segment is a pause;
 * opening a new one is a resume. The gaps between consecutive segments are the
 * pause gaps shown on client-facing statements.
 */
export const entrySegments = pgTable(
  'entry_segments',
  {
    id: serial('id').primaryKey(),
    entryId: text('entry_id')
      .notNull()
      .references(() => timeEntries.id, { onDelete: 'cascade' }),
    startMs: bigint('start_ms', { mode: 'number' }).notNull(),
    /** NULL while this sitting is actively running. */
    endMs: bigint('end_ms', { mode: 'number' }),
  },
  (t) => ({ entryIdx: index('segment_entry_idx').on(t.entryId) }),
);

/** Singleton settings row (id = 1). */
export const settings = pgTable('settings', {
  id: integer('id').primaryKey(),
  firmName: text('firm_name').notNull().default('משרד עורכי דין'),
  firmEmail: text('firm_email'),
  firmAddress: text('firm_address'),
  firmPhone: text('firm_phone'),
  taxId: text('tax_id'),
  /** Firm logo as a URL or a data: URI (base64). Shown on invoices + reports. */
  logoUrl: text('logo_url'),
  /** Where the automatic monthly reports are sent. */
  reportEmail: text('report_email'),
  defaultCurrency: text('default_currency').notNull().default('ILS'),
  defaultHourlyRate: doublePrecision('default_hourly_rate').notNull().default(0),
  /** Billing rounds each entry up to this many minutes (legal norm: 6). */
  roundIncrementMin: integer('round_increment_min').notNull().default(6),
  timezone: text('timezone').notNull().default('Asia/Jerusalem'),
  locale: text('locale').notNull().default('he'), // 'he' | 'en'
  /** Master switch for the monthly auto-send cron. */
  autoSendMonthly: integer('auto_send_monthly').notNull().default(0),
  /** Last month key we auto-sent (e.g. "2026-06"), so the cron fires once. */
  lastMonthlySentKey: text('last_monthly_sent_key'),
  /** Running invoice number sequence. */
  invoiceSeq: integer('invoice_seq').notNull().default(0),
  /** VAT percentage added on invoices (Israeli standard rate: 18). 0 = none. */
  vatRate: doublePrecision('vat_rate').notNull().default(18),
});

/**
 * Additional people allowed to sign in, managed from Settings. Checked at
 * login alongside the OWNER_EMAIL env allowlist, so the owner can add a
 * colleague without redeploying.
 */
export const appUsers = pgTable('app_users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  name: text('name'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * An issued invoice. Identity fields (firm, client, logo, case number) are
 * snapshotted at issue time so the document stays stable even if records change
 * later. Lines can come from tracked hours and/or flat one-off charges.
 */
export const invoices = pgTable(
  'invoices',
  {
    id: text('id').primaryKey(),
    number: text('number').notNull(),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('unpaid'), // 'unpaid' | 'paid'
    currency: text('currency').notNull(),
    /** Sum of the lines, before VAT. */
    subtotal: doublePrecision('subtotal').notNull(),
    /** VAT percentage applied at issue time (snapshot; 0 on legacy rows). */
    vatRate: doublePrecision('vat_rate').notNull().default(0),
    vatAmount: doublePrecision('vat_amount').notNull().default(0),
    /** subtotal + vatAmount — the figure the client owes. */
    total: doublePrecision('total').notNull().default(0),
    notes: text('notes'),
    // snapshots
    firmName: text('firm_name').notNull().default(''),
    firmEmail: text('firm_email'),
    firmAddress: text('firm_address'),
    firmPhone: text('firm_phone'),
    taxId: text('tax_id'),
    logoUrl: text('logo_url'),
    clientName: text('client_name').notNull(),
    clientEmail: text('client_email'),
    clientAddress: text('client_address'),
    caseNumber: text('case_number'),
    caseName: text('case_name'),
    emailedAt: timestamp('emailed_at', { withTimezone: true }),
    emailedTo: text('emailed_to'),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
  },
  (t) => ({ clientIdx: index('invoice_client_idx').on(t.clientId) }),
);

export const invoiceLines = pgTable(
  'invoice_lines',
  {
    id: serial('id').primaryKey(),
    invoiceId: text('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    /** 0/0 for a flat one-off line; otherwise hours × ratePerHour. */
    hours: doublePrecision('hours').notNull().default(0),
    ratePerHour: doublePrecision('rate_per_hour').notNull().default(0),
    amount: doublePrecision('amount').notNull(),
  },
  (t) => ({ invoiceIdx: index('invoice_line_invoice_idx').on(t.invoiceId) }),
);

export type Client = typeof clients.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type TimeEntry = typeof timeEntries.$inferSelect;
export type EntrySegment = typeof entrySegments.$inferSelect;
export type Settings = typeof settings.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type AppUser = typeof appUsers.$inferSelect;
export type InvoiceLine = typeof invoiceLines.$inferSelect;
