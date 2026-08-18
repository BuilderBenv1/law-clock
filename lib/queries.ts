import { and, desc, eq, gte, isNull, isNotNull, lt, sql } from 'drizzle-orm';
import { getDb } from './db';
import { clients, projects, tasks, timeEntries, type Client, type Project, type Task, type TimeEntry } from './db/schema';
import { getSettings } from './settings';
import { billableHours, hoursOf, dayKey } from './time';
import { round2 } from './util';

/** Resolve the effective hourly rate for a case. */
export function effectiveRate(
  project: Pick<Project, 'hourlyRate'> | null,
  client: Pick<Client, 'hourlyRate'>,
  defaultRate: number,
): number {
  if (project?.hourlyRate != null && project.hourlyRate > 0) return project.hourlyRate;
  if (client.hourlyRate > 0) return client.hourlyRate;
  return defaultRate;
}

export interface RunningTimer {
  entry: TimeEntry;
  clientName: string;
  projectName: string;
  taskName: string | null;
}

/** The single currently-running timer (endMs IS NULL), with its labels. */
export async function getRunningTimer(): Promise<RunningTimer | null> {
  const db = getDb();
  const [row] = await db
    .select({
      entry: timeEntries,
      clientName: clients.name,
      projectName: projects.name,
      taskName: tasks.name,
    })
    .from(timeEntries)
    .innerJoin(clients, eq(clients.id, timeEntries.clientId))
    .innerJoin(projects, eq(projects.id, timeEntries.projectId))
    .leftJoin(tasks, eq(tasks.id, timeEntries.taskId))
    .where(isNull(timeEntries.endMs))
    .orderBy(desc(timeEntries.startMs))
    .limit(1);
  if (!row) return null;
  return { entry: row.entry, clientName: row.clientName, projectName: row.projectName, taskName: row.taskName };
}

export interface EntryRow {
  entry: TimeEntry;
  clientName: string;
  projectName: string;
  taskName: string | null;
}

/** Recent finished sessions with labels. */
export async function recentEntries(limit = 15): Promise<EntryRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      entry: timeEntries,
      clientName: clients.name,
      projectName: projects.name,
      taskName: tasks.name,
    })
    .from(timeEntries)
    .innerJoin(clients, eq(clients.id, timeEntries.clientId))
    .innerJoin(projects, eq(projects.id, timeEntries.projectId))
    .leftJoin(tasks, eq(tasks.id, timeEntries.taskId))
    .where(isNotNull(timeEntries.endMs))
    .orderBy(desc(timeEntries.startMs))
    .limit(limit);
  return rows.map((r) => ({ entry: r.entry, clientName: r.clientName, projectName: r.projectName, taskName: r.taskName }));
}

export interface ResumableTask {
  clientId: string;
  clientName: string;
  projectId: string;
  projectName: string;
  taskId: string | null;
  taskName: string;
  lastEndMs: number;
  totalMs: number;
}

/**
 * Distinct pieces of work that can be picked up again in one click. Grouped by
 * task so pausing and resuming across days collapses into a single row showing
 * the accumulated time, rather than a wall of separate sessions.
 */
export async function resumableTasks(limit = 8): Promise<ResumableTask[]> {
  const db = getDb();
  const rows = await db
    .select({
      clientId: timeEntries.clientId,
      clientName: clients.name,
      projectId: timeEntries.projectId,
      projectName: projects.name,
      taskId: timeEntries.taskId,
      taskName: sql<string>`coalesce(${tasks.name}, ${timeEntries.description}, '')`,
      lastEndMs: sql<number>`max(${timeEntries.endMs})`,
      totalMs: sql<number>`sum(coalesce(${timeEntries.durationMs}, 0))`,
    })
    .from(timeEntries)
    .innerJoin(clients, eq(clients.id, timeEntries.clientId))
    .innerJoin(projects, eq(projects.id, timeEntries.projectId))
    .leftJoin(tasks, eq(tasks.id, timeEntries.taskId))
    .where(isNotNull(timeEntries.endMs))
    .groupBy(
      timeEntries.clientId,
      clients.name,
      timeEntries.projectId,
      projects.name,
      timeEntries.taskId,
      sql`coalesce(${tasks.name}, ${timeEntries.description}, '')`,
    )
    .orderBy(sql`max(${timeEntries.endMs}) desc`)
    .limit(limit);

  return rows
    .filter((r) => r.taskName)
    .map((r) => ({
      clientId: r.clientId,
      clientName: r.clientName,
      projectId: r.projectId,
      projectName: r.projectName,
      taskId: r.taskId,
      taskName: r.taskName,
      lastEndMs: Number(r.lastEndMs) || 0,
      totalMs: Number(r.totalMs) || 0,
    }));
}

/** Sum of finished-session hours whose start falls in [fromMs, toMs). */
export async function hoursInWindow(fromMs: number, toMs: number): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ durationMs: timeEntries.durationMs })
    .from(timeEntries)
    .where(and(isNotNull(timeEntries.durationMs), gte(timeEntries.startMs, fromMs), lt(timeEntries.startMs, toMs)));
  return hoursOf(rows.reduce((s, r) => s + (r.durationMs ?? 0), 0));
}

export interface CaseTotals {
  /** Actual clock time worked. */
  hours: number;
  /** Chargeable time after rounding each session up — what the client is billed. */
  billedHours: number;
  /** Time deliberately not charged. */
  nonBillableHours: number;
}

function totalsOf(rows: { durationMs: number | null; billable: number }[], inc: number): CaseTotals {
  let ms = 0;
  let billed = 0;
  let nonBillableMs = 0;
  for (const r of rows) {
    const d = r.durationMs ?? 0;
    ms += d;
    if (r.billable === 1) billed += billableHours(d, inc);
    else nonBillableMs += d;
  }
  return { hours: hoursOf(ms), billedHours: round2(billed), nonBillableHours: hoursOf(nonBillableMs) };
}

/** Hours for a case, split into actual / billed / written-off. */
export async function caseTotals(projectId: string, roundIncrementMin: number): Promise<CaseTotals> {
  const db = getDb();
  const rows = await db
    .select({ durationMs: timeEntries.durationMs, billable: timeEntries.billable })
    .from(timeEntries)
    .where(and(eq(timeEntries.projectId, projectId), isNotNull(timeEntries.durationMs)));
  return totalsOf(rows, roundIncrementMin);
}

/** Total logged hours for a case (actual clock time). */
export async function caseHours(projectId: string): Promise<number> {
  const s = await getSettings();
  return (await caseTotals(projectId, s.roundIncrementMin)).hours;
}

/** Client-wide totals, used by the client-level alert. */
export async function clientTotals(clientId: string, roundIncrementMin: number): Promise<CaseTotals> {
  const db = getDb();
  const rows = await db
    .select({ durationMs: timeEntries.durationMs, billable: timeEntries.billable })
    .from(timeEntries)
    .where(and(eq(timeEntries.clientId, clientId), isNotNull(timeEntries.durationMs)));
  return totalsOf(rows, roundIncrementMin);
}

export interface CaseSummary {
  project: Project;
  clientName: string;
  hours: number;
  amount: number;
}

/** Open cases with logged hours and charge, for threshold progress on the dashboard. */
export async function activeCasesWithHours(): Promise<CaseSummary[]> {
  const db = getDb();
  const s = await getSettings();
  const rows = await db
    .select({ project: projects, client: clients })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(and(eq(projects.status, 'open'), eq(projects.archived, 0)))
    .orderBy(desc(projects.createdAt));

  const out: CaseSummary[] = [];
  for (const r of rows) {
    const totals = await caseTotals(r.project.id, s.roundIncrementMin);
    out.push({
      project: r.project,
      clientName: r.client.name,
      hours: totals.hours,
      amount: round2(totals.billedHours * effectiveRate(r.project, r.client, s.defaultHourlyRate)),
    });
  }
  return out;
}

/** Charge accrued for a client across every case, honouring per-case rates. */
export async function clientAmount(clientId: string): Promise<number> {
  const db = getDb();
  const s = await getSettings();
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId));
  if (!client) return 0;
  const ps = await db.select().from(projects).where(eq(projects.clientId, clientId));
  let amount = 0;
  for (const p of ps) {
    const t = await caseTotals(p.id, s.roundIncrementMin);
    amount += t.billedHours * effectiveRate(p, client, s.defaultHourlyRate);
  }
  return round2(amount);
}

export interface ClientWithTotals {
  client: Client;
  openCases: number;
  hours: number;
}

export async function listClientsWithTotals(): Promise<ClientWithTotals[]> {
  const db = getDb();
  const cs = await db.select().from(clients).where(eq(clients.archived, 0)).orderBy(clients.name);
  const out: ClientWithTotals[] = [];
  for (const c of cs) {
    const ps = await db
      .select({ id: projects.id, status: projects.status })
      .from(projects)
      .where(and(eq(projects.clientId, c.id), eq(projects.archived, 0)));
    const entries = await db
      .select({ durationMs: timeEntries.durationMs })
      .from(timeEntries)
      .where(and(eq(timeEntries.clientId, c.id), isNotNull(timeEntries.durationMs)));
    out.push({
      client: c,
      openCases: ps.filter((p) => p.status === 'open').length,
      hours: hoursOf(entries.reduce((s, r) => s + (r.durationMs ?? 0), 0)),
    });
  }
  return out;
}

export interface ClientDetail {
  client: Client;
  cases: { project: Project; hours: number; taskCount: number }[];
}

export async function getClientDetail(clientId: string): Promise<ClientDetail | null> {
  const db = getDb();
  const s = await getSettings();
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId));
  if (!client) return null;
  const ps = await db
    .select()
    .from(projects)
    .where(and(eq(projects.clientId, clientId), eq(projects.archived, 0)))
    .orderBy(desc(projects.isDefault), desc(projects.createdAt));
  const cases: ClientDetail['cases'] = [];
  for (const p of ps) {
    const ts = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.archived, 0)));
    cases.push({ project: p, hours: (await caseTotals(p.id, s.roundIncrementMin)).hours, taskCount: ts.length });
  }
  return { client, cases };
}

export interface ProjectDetail {
  project: Project;
  client: Client;
  tasks: Task[];
  entries: EntryRow[];
  hours: number;
  billedHours: number;
  nonBillableHours: number;
  rate: number;
  currency: string;
  amount: number;
}

export async function getProjectDetail(projectId: string): Promise<ProjectDetail | null> {
  const db = getDb();
  const s = await getSettings();
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return null;
  const [client] = await db.select().from(clients).where(eq(clients.id, project.clientId));
  if (!client) return null;

  const ts = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.archived, 0)))
    .orderBy(desc(tasks.createdAt));

  const rawEntries = await db
    .select({ entry: timeEntries, taskName: tasks.name })
    .from(timeEntries)
    .leftJoin(tasks, eq(tasks.id, timeEntries.taskId))
    .where(and(eq(timeEntries.projectId, projectId), isNotNull(timeEntries.durationMs)))
    .orderBy(desc(timeEntries.startMs));

  const entries: EntryRow[] = rawEntries.map((r) => ({
    entry: r.entry,
    clientName: client.name,
    projectName: project.name,
    taskName: r.taskName,
  }));

  const totals = totalsOf(
    entries.map((e) => ({ durationMs: e.entry.durationMs, billable: e.entry.billable })),
    s.roundIncrementMin,
  );
  const rate = effectiveRate(project, client, s.defaultHourlyRate);
  return {
    project,
    client,
    tasks: ts,
    entries,
    hours: totals.hours,
    billedHours: totals.billedHours,
    nonBillableHours: totals.nonBillableHours,
    rate,
    currency: client.currency,
    amount: round2(totals.billedHours * rate),
  };
}

// ----------------------- Reports -----------------------

export interface ReportSession {
  id: string;
  startMs: number;
  endMs: number | null;
  hours: number;
  billedHours: number;
  billable: boolean;
  description: string | null;
  /** Idle time between the end of the previous session on this task and this one. */
  gapMsBefore: number | null;
}

export interface ReportTaskGroup {
  taskName: string;
  sessions: ReportSession[];
  hours: number;
  billedHours: number;
  nonBillableHours: number;
  amount: number;
}

export interface ReportCaseGroup {
  projectId: string;
  caseName: string;
  caseNumber: string | null;
  rate: number;
  tasks: ReportTaskGroup[];
  hours: number;
  billedHours: number;
  nonBillableHours: number;
  amount: number;
}

export interface ReportBucket {
  label: string;
  hours: number;
  billedHours: number;
}

export interface ReportData {
  client: Client;
  project: Project | null; // null = every case for the client
  fromMs: number;
  toMs: number;
  allTime: boolean;
  cases: ReportCaseGroup[];
  byTask: ReportBucket[];
  byDay: ReportBucket[];
  /** Actual clock time worked. */
  totalHours: number;
  /** Chargeable time after per-session rounding — the number that is invoiced. */
  totalBilledHours: number;
  /** Time tracked but written off. */
  totalNonBillableHours: number;
  sessionCount: number;
  roundIncrementMin: number;
  amount: number;
  currency: string;
  /** Representative rate: the case rate when scoped to one case, else the client's. */
  rate: number;
}

/**
 * Build every number behind a report: each finished session for a client (and
 * optionally one case) starting inside [fromMs, toMs), grouped case -> task ->
 * session, with the pause gap before each session. Feeds the on-screen report,
 * the CSV, the PDF statement and the monthly email.
 *
 * Pass `allTime` to ignore the window entirely.
 */
export async function buildReport(opts: {
  clientId: string;
  projectId?: string | null;
  fromMs: number;
  toMs: number;
  allTime?: boolean;
}): Promise<ReportData | null> {
  const db = getDb();
  const s = await getSettings();
  const [client] = await db.select().from(clients).where(eq(clients.id, opts.clientId));
  if (!client) return null;

  let project: Project | null = null;
  if (opts.projectId) {
    const [p] = await db.select().from(projects).where(eq(projects.id, opts.projectId));
    project = p ?? null;
  }

  const where = [eq(timeEntries.clientId, opts.clientId), isNotNull(timeEntries.durationMs)];
  if (!opts.allTime) {
    where.push(gte(timeEntries.startMs, opts.fromMs), lt(timeEntries.startMs, opts.toMs));
  }
  if (opts.projectId) where.push(eq(timeEntries.projectId, opts.projectId));

  const rows = await db
    .select({ entry: timeEntries, taskName: tasks.name, project: projects })
    .from(timeEntries)
    .innerJoin(projects, eq(projects.id, timeEntries.projectId))
    .leftJoin(tasks, eq(tasks.id, timeEntries.taskId))
    .where(and(...where))
    .orderBy(timeEntries.startMs);

  const inc = s.roundIncrementMin;
  const caseMap = new Map<string, ReportCaseGroup>();
  const taskBuckets = new Map<string, ReportBucket>();
  const dayBuckets = new Map<string, ReportBucket>();

  for (const row of rows) {
    const e = row.entry;
    const duration = e.durationMs ?? 0;
    const isBillable = e.billable === 1;
    const hours = hoursOf(duration);
    const billed = isBillable ? billableHours(duration, inc) : 0;
    const label = row.taskName ?? e.description ?? '—';

    let group = caseMap.get(e.projectId);
    if (!group) {
      group = {
        projectId: e.projectId,
        caseName: row.project.name,
        caseNumber: row.project.caseNumber,
        rate: effectiveRate(row.project, client, s.defaultHourlyRate),
        tasks: [],
        hours: 0,
        billedHours: 0,
        nonBillableHours: 0,
        amount: 0,
      };
      caseMap.set(e.projectId, group);
    }

    let task = group.tasks.find((t) => t.taskName === label);
    if (!task) {
      task = { taskName: label, sessions: [], hours: 0, billedHours: 0, nonBillableHours: 0, amount: 0 };
      group.tasks.push(task);
    }

    const prev = task.sessions[task.sessions.length - 1];
    const gapMsBefore = prev?.endMs != null && e.startMs > prev.endMs ? e.startMs - prev.endMs : null;

    task.sessions.push({
      id: e.id,
      startMs: e.startMs,
      endMs: e.endMs,
      hours,
      billedHours: billed,
      billable: isBillable,
      description: e.description,
      gapMsBefore,
    });

    task.hours = round2(task.hours + hours);
    task.billedHours = round2(task.billedHours + billed);
    if (!isBillable) task.nonBillableHours = round2(task.nonBillableHours + hours);

    group.hours = round2(group.hours + hours);
    group.billedHours = round2(group.billedHours + billed);
    if (!isBillable) group.nonBillableHours = round2(group.nonBillableHours + hours);

    const tb = taskBuckets.get(label) ?? { label, hours: 0, billedHours: 0 };
    tb.hours = round2(tb.hours + hours);
    tb.billedHours = round2(tb.billedHours + billed);
    taskBuckets.set(label, tb);

    const dk = dayKey(e.startMs, s.timezone);
    const bucket = dayBuckets.get(dk) ?? { label: dk, hours: 0, billedHours: 0 };
    bucket.hours = round2(bucket.hours + hours);
    bucket.billedHours = round2(bucket.billedHours + billed);
    dayBuckets.set(dk, bucket);
  }

  const cases = [...caseMap.values()];
  for (const c of cases) {
    for (const t of c.tasks) t.amount = round2(t.billedHours * c.rate);
    c.tasks.sort((a, b) => b.hours - a.hours);
    c.amount = round2(c.billedHours * c.rate);
  }
  cases.sort((a, b) => b.hours - a.hours);

  return {
    client,
    project,
    fromMs: opts.fromMs,
    toMs: opts.toMs,
    allTime: !!opts.allTime,
    cases,
    byTask: [...taskBuckets.values()].sort((a, b) => b.hours - a.hours),
    byDay: [...dayBuckets.values()].sort((a, b) => a.label.localeCompare(b.label)),
    totalHours: round2(cases.reduce((sum, c) => sum + c.hours, 0)),
    totalBilledHours: round2(cases.reduce((sum, c) => sum + c.billedHours, 0)),
    totalNonBillableHours: round2(cases.reduce((sum, c) => sum + c.nonBillableHours, 0)),
    sessionCount: rows.length,
    roundIncrementMin: inc,
    amount: round2(cases.reduce((sum, c) => sum + c.amount, 0)),
    currency: client.currency,
    rate: effectiveRate(project, client, s.defaultHourlyRate),
  };
}

/** Flatten a report back into one row per session — for CSV and detail tables. */
export function reportSessions(report: ReportData): {
  caseName: string;
  caseNumber: string | null;
  taskName: string;
  session: ReportSession;
}[] {
  const out: { caseName: string; caseNumber: string | null; taskName: string; session: ReportSession }[] = [];
  for (const c of report.cases) {
    for (const t of c.tasks) {
      for (const session of t.sessions) {
        out.push({ caseName: c.caseName, caseNumber: c.caseNumber, taskName: t.taskName, session });
      }
    }
  }
  return out.sort((a, b) => a.session.startMs - b.session.startMs);
}

export async function listClientsPlain(): Promise<Client[]> {
  const db = getDb();
  return db.select().from(clients).where(eq(clients.archived, 0)).orderBy(clients.name);
}

export async function listProjectsForClient(clientId: string): Promise<Project[]> {
  const db = getDb();
  return db
    .select()
    .from(projects)
    .where(and(eq(projects.clientId, clientId), eq(projects.archived, 0)))
    .orderBy(desc(projects.isDefault), desc(projects.createdAt));
}

export interface ClientTreeNode {
  id: string;
  name: string;
  projects: { id: string; name: string; caseNumber: string | null; isDefault: boolean }[];
  /** Previously-used task names across this client's cases, newest first. */
  taskNames: string[];
}

/** Client -> open cases -> previous task names, for the timer's pickers. */
export async function getClientsTree(): Promise<ClientTreeNode[]> {
  const db = getDb();
  const cs = await db.select().from(clients).where(eq(clients.archived, 0)).orderBy(clients.name);
  if (cs.length === 0) return [];

  const ps = await db
    .select()
    .from(projects)
    .where(and(eq(projects.archived, 0), eq(projects.status, 'open')))
    .orderBy(desc(projects.isDefault), desc(projects.createdAt));

  const names = await db
    .select({
      clientId: projects.clientId,
      name: tasks.name,
      lastUsed: sql<number>`coalesce(max(${timeEntries.startMs}), 0)`,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(timeEntries, eq(timeEntries.taskId, tasks.id))
    .where(eq(tasks.archived, 0))
    .groupBy(projects.clientId, tasks.name)
    .orderBy(sql`coalesce(max(${timeEntries.startMs}), 0) desc`);

  return cs.map((c) => ({
    id: c.id,
    name: c.name,
    projects: ps
      .filter((p) => p.clientId === c.id)
      .map((p) => ({ id: p.id, name: p.name, caseNumber: p.caseNumber, isDefault: p.isDefault === 1 })),
    taskNames: [...new Set(names.filter((n) => n.clientId === c.id).map((n) => n.name))].slice(0, 30),
  }));
}
