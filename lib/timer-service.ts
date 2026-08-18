import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from './db';
import { clients, entrySegments, projects, tasks, timeEntries, type EntrySegment, type TimeEntry } from './db/schema';
import { newId } from './util';

/**
 * Timer engine built on task sessions made of segments.
 *
 *   start   → new entry (status 'running') + first open segment
 *   pause   → close the open segment, entry becomes 'paused'
 *   resume  → open a new segment, entry becomes 'running'
 *   stop    → close the open segment, set endMs, entry becomes 'stopped'
 *
 * Worked time is the sum of closed segments (plus the live one while running),
 * so paused gaps are never billed — but they are recorded, which is what lets
 * client statements show exactly when work was interrupted.
 */

/** Worked ms across segments; the open segment is measured up to `now`. */
export function workedMs(segments: Pick<EntrySegment, 'startMs' | 'endMs'>[], now: number = Date.now()): number {
  let total = 0;
  for (const s of segments) {
    const end = s.endMs ?? now;
    total += Math.max(0, end - s.startMs);
  }
  return total;
}

/** Recompute and persist an entry's duration from its segments. */
async function syncDuration(entryId: string): Promise<number> {
  const db = getDb();
  const segs = await db.select().from(entrySegments).where(eq(entrySegments.entryId, entryId));
  const total = workedMs(segs.filter((s) => s.endMs != null));
  await db.update(timeEntries).set({ durationMs: total }).where(eq(timeEntries.id, entryId));
  return total;
}

/** Close whatever segment is open on an entry. Returns true if one was open. */
async function closeOpenSegment(entryId: string, at: number): Promise<boolean> {
  const db = getDb();
  const open = await db
    .select()
    .from(entrySegments)
    .where(and(eq(entrySegments.entryId, entryId), isNull(entrySegments.endMs)));
  if (open.length === 0) return false;
  for (const s of open) {
    await db.update(entrySegments).set({ endMs: Math.max(s.startMs, at) }).where(eq(entrySegments.id, s.id));
  }
  return true;
}

/**
 * Stop every running/paused entry — used before starting new work so exactly one
 * session is ever live. Returns the project ids touched, for threshold checks.
 */
export async function stopAllActive(at: number = Date.now()): Promise<string[]> {
  const db = getDb();
  const active = await db
    .select()
    .from(timeEntries)
    .where(sql`${timeEntries.status} in ('running','paused')`);
  const touched: string[] = [];
  for (const e of active) {
    await closeOpenSegment(e.id, at);
    const total = await syncDuration(e.id);
    await db
      .update(timeEntries)
      .set({ status: 'stopped', endMs: at, durationMs: total })
      .where(eq(timeEntries.id, e.id));
    touched.push(e.projectId);
  }
  return touched;
}

export interface StartArgs {
  clientId: string;
  projectId: string;
  /** Free text; doubles as the task name so history stays groupable. */
  title: string;
  at?: number;
}

/**
 * Begin a new task session. The title is matched against the case's existing
 * tasks (case-insensitive) and reused when it matches, so repeated work rolls
 * up under one task in reports instead of creating near-duplicates.
 */
export async function startSession(args: StartArgs): Promise<{ id: string; stoppedProjects: string[] }> {
  const db = getDb();
  const at = args.at ?? Date.now();
  const stoppedProjects = await stopAllActive(at);

  const title = args.title.trim();
  const taskId = title ? await findOrCreateTask(args.projectId, title) : null;

  const id = newId();
  await db.insert(timeEntries).values({
    id,
    clientId: args.clientId,
    projectId: args.projectId,
    taskId,
    description: title || null,
    startMs: at,
    endMs: null,
    durationMs: 0,
    status: 'running',
    billable: 1,
  });
  await db.insert(entrySegments).values({ entryId: id, startMs: at, endMs: null });
  return { id, stoppedProjects };
}

/** Reuse a task with this name on the case, or create it. */
export async function findOrCreateTask(projectId: string, name: string): Promise<string> {
  const db = getDb();
  const trimmed = name.trim();
  const [existing] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), sql`lower(${tasks.name}) = lower(${trimmed})`))
    .limit(1);
  if (existing) {
    if (existing.archived === 1) {
      await db.update(tasks).set({ archived: 0 }).where(eq(tasks.id, existing.id));
    }
    return existing.id;
  }
  const id = newId();
  await db.insert(tasks).values({ id, projectId, name: trimmed });
  return id;
}

export async function pauseSession(entryId: string, at: number = Date.now()): Promise<void> {
  const db = getDb();
  const [entry] = await db.select().from(timeEntries).where(eq(timeEntries.id, entryId));
  if (!entry || entry.status !== 'running') return;
  await closeOpenSegment(entryId, at);
  const total = await syncDuration(entryId);
  await db.update(timeEntries).set({ status: 'paused', durationMs: total }).where(eq(timeEntries.id, entryId));
}

/**
 * Resume a paused — or already-stopped — session by opening a fresh segment.
 * Resuming finished work is how "carry on with that task from yesterday" works
 * from the recent-entries list, and the gap becomes a visible pause.
 */
export async function resumeSession(entryId: string, at: number = Date.now()): Promise<void> {
  const db = getDb();
  const [entry] = await db.select().from(timeEntries).where(eq(timeEntries.id, entryId));
  if (!entry || entry.status === 'running') return;
  await stopAllActive(at);
  await db.insert(entrySegments).values({ entryId, startMs: at, endMs: null });
  await db.update(timeEntries).set({ status: 'running', endMs: null }).where(eq(timeEntries.id, entryId));
}

export async function stopSession(entryId: string, at: number = Date.now()): Promise<string | null> {
  const db = getDb();
  const [entry] = await db.select().from(timeEntries).where(eq(timeEntries.id, entryId));
  if (!entry || entry.status === 'stopped') return null;
  await closeOpenSegment(entryId, at);
  const total = await syncDuration(entryId);
  await db
    .update(timeEntries)
    .set({ status: 'stopped', endMs: at, durationMs: total })
    .where(eq(timeEntries.id, entryId));
  return entry.projectId;
}

export interface ActiveSession {
  entry: TimeEntry;
  segments: EntrySegment[];
  clientName: string;
  projectName: string;
  taskName: string | null;
  /** Worked ms already banked in closed segments. */
  bankedMs: number;
  /** Server timestamp the live segment started, or null when paused. */
  liveSinceMs: number | null;
}

/** The one running-or-paused session, with everything the widget needs. */
export async function getActiveSession(): Promise<ActiveSession | null> {
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
    .where(sql`${timeEntries.status} in ('running','paused')`)
    .orderBy(desc(timeEntries.startMs))
    .limit(1);
  if (!row) return null;

  const segments = await db
    .select()
    .from(entrySegments)
    .where(eq(entrySegments.entryId, row.entry.id))
    .orderBy(entrySegments.startMs);

  const closed = segments.filter((s) => s.endMs != null);
  const live = segments.find((s) => s.endMs == null) ?? null;

  return {
    entry: row.entry,
    segments,
    clientName: row.clientName,
    projectName: row.projectName,
    taskName: row.taskName,
    bankedMs: workedMs(closed),
    liveSinceMs: live?.startMs ?? null,
  };
}

/** Segments for a set of entries, for statements that show pause gaps. */
export async function segmentsForEntries(entryIds: string[]): Promise<Map<string, EntrySegment[]>> {
  const out = new Map<string, EntrySegment[]>();
  if (entryIds.length === 0) return out;
  const db = getDb();
  const rows = await db
    .select()
    .from(entrySegments)
    .where(sql`${entrySegments.entryId} in ${entryIds}`)
    .orderBy(entrySegments.startMs);
  for (const r of rows) {
    const list = out.get(r.entryId) ?? [];
    list.push(r);
    out.set(r.entryId, list);
  }
  return out;
}

/** Toggle whether an entry is charged to the client. */
export async function setEntryBillable(entryId: string, billable: boolean): Promise<void> {
  const db = getDb();
  await db.update(timeEntries).set({ billable: billable ? 1 : 0 }).where(eq(timeEntries.id, entryId));
}
