import {
  pgTable,
  text,
  integer,
  bigint,
  doublePrecision,
  timestamp,
  serial,
  index,
} from 'drizzle-orm/pg-core';

/**
 * Data model mirrors the way a lawyer thinks about their work:
 * Client -> Case (a matter) -> Task. Every timer segment (a `time_entry`) is
 * booked against a task, so hours roll up cleanly into a case total and then a
 * client total.
 *
 * Pause/resume is modelled by having several entries share one task: each entry
 * is a *session*, and the gap between two sessions is a pause. Client-facing
 * documents render those gaps so the client can see exactly when work happened.
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
    /** Client-wide alerts (across every case). Null = no alert. */
    alertThresholdHours: doublePrecision('alert_threshold_hours'),
    alertThresholdAmount: doublePrecision('alert_threshold_amount'),
    alertNotifiedHours: doublePrecision('alert_notified_hours'),
    alertNotifiedAmount: doublePrecision('alert_notified_amount'),
    alertNotifiedAt: timestamp('alert_notified_at', { withTimezone: true }),
    archived: integer('archived').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ nameIdx: index('client_name_idx').on(t.name) }),
);

/**
 * A case / matter. Belongs to a client. Carries an optional rate override and
 * optional hours/amount alert thresholds: when the case reaches them the client
 * is notified automatically. `alertNotified*` records the threshold value we
 * already fired on, so the same alert never repeats until the threshold moves.
 *
 * `isDefault` marks the auto-created general / uncategorised case that every
 * client gets, so work can be logged without choosing a case first.
 */
export const projects = pgTable(
  'projects',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Firm case/matter number (e.g. "2026-0143"); optional, shown with the name. */
    caseNumber: text('case_number'),
    description: text('description'),
    status: text('status').notNull().default('open'), // 'open' | 'closed'
    /** Per-case hourly rate override; null = use the client rate. */
    hourlyRate: doublePrecision('hourly_rate'),
    /** Notify the client once the case reaches this many hours; null = no alert. */
    alertThresholdHours: doublePrecision('alert_threshold_hours'),
    /** Notify the client once the case reaches this billed amount; null = no alert. */
    alertThresholdAmount: doublePrecision('alert_threshold_amount'),
    alertNotifiedHours: doublePrecision('alert_notified_hours'),
    alertNotifiedAmount: doublePrecision('alert_notified_amount'),
    alertNotifiedAt: timestamp('alert_notified_at', { withTimezone: true }),
    /** 1 = the catch-all case for uncategorised work. */
    isDefault: integer('is_default').notNull().default(0),
    archived: integer('archived').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => ({ clientIdx: index('project_client_idx').on(t.clientId) }),
);

/**
 * A task within a case — the unit of work a timer is booked against. Tasks are
 * created on the fly from what the lawyer types in the timer box, and offered
 * back as suggestions next time (the "previous tasks" picker).
 */
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
 * One work session — the output of "start timer / pause timer", or a manual
 * entry. `endMs` NULL means the timer is running now. Client and project are
 * denormalized so hours aggregate without joins and survive a task rename.
 *
 * `billable = 0` means the time is tracked but never charged (pro-bono,
 * internal, written off): it shows in reports as non-billable and is excluded
 * from invoices and amount totals.
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
    /** NULL while the timer runs. */
    endMs: bigint('end_ms', { mode: 'number' }),
    /** Milliseconds of work; NULL while running, set on pause / on manual entry. */
    durationMs: bigint('duration_ms', { mode: 'number' }),
    /** 1 = chargeable (default), 0 = tracked but not billed. */
    billable: integer('billable').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    clientIdx: index('entry_client_idx').on(t.clientId),
    projectIdx: index('entry_project_idx').on(t.projectId),
    startIdx: index('entry_start_idx').on(t.startMs),
    taskIdx: index('entry_task_idx').on(t.taskId),
  }),
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
  /** Billing rounds each session up to this many minutes (legal norm: 6). */
  roundIncrementMin: integer('round_increment_min').notNull().default(6),
  timezone: text('timezone').notNull().default('Asia/Jerusalem'),
  locale: text('locale').notNull().default('he'), // 'he' | 'en'
  /** Master switch for the monthly auto-send cron. */
  autoSendMonthly: integer('auto_send_monthly').notNull().default(0),
  /** Last month key we auto-sent (e.g. "2026-06"), so the cron fires once. */
  lastMonthlySentKey: text('last_monthly_sent_key'),
  /** Running invoice number sequence. */
  invoiceSeq: integer('invoice_seq').notNull().default(0),
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
    subtotal: doublePrecision('subtotal').notNull(),
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
    /** 0/0 for a flat one-off line; otherwise hours x ratePerHour. */
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
export type Settings = typeof settings.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type InvoiceLine = typeof invoiceLines.$inferSelect;
