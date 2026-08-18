import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from './db';
import { clients, projects, tasks, timeEntries, type Project } from './db/schema';
import { newId } from './util';

export const DEFAULT_CASE_NAME_HE = 'עבודה כללית';
export const DEFAULT_CASE_NAME_EN = 'General work';

/**
 * Every client gets a catch-all case so work can be tracked the moment the
 * client exists — no "you must create a case first" wall. It is created lazily
 * and reused, and behaves like any other case (it can be renamed, given a rate,
 * invoiced) except that it is what the timer falls back to.
 */
export async function ensureDefaultCase(clientId: string, locale: 'he' | 'en' = 'he'): Promise<Project> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.clientId, clientId), eq(projects.isDefault, 1)))
    .limit(1);
  if (existing) return existing;

  const id = newId();
  await db.insert(projects).values({
    id,
    clientId,
    name: locale === 'en' ? DEFAULT_CASE_NAME_EN : DEFAULT_CASE_NAME_HE,
    isDefault: 1,
    status: 'open',
  });
  const [created] = await db.select().from(projects).where(eq(projects.id, id));
  return created!;
}

/** Create a client and its catch-all case in one go. */
export async function createClientWithDefaultCase(
  values: {
    name: string;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    hourlyRate?: number;
    currency: string;
    notes?: string | null;
  },
  locale: 'he' | 'en' = 'he',
): Promise<{ clientId: string; defaultProjectId: string }> {
  const db = getDb();
  const clientId = newId();
  await db.insert(clients).values({
    id: clientId,
    name: values.name,
    email: values.email ?? null,
    phone: values.phone ?? null,
    address: values.address ?? null,
    hourlyRate: values.hourlyRate ?? 0,
    currency: values.currency,
    notes: values.notes ?? null,
  });
  const def = await ensureDefaultCase(clientId, locale);
  return { clientId, defaultProjectId: def.id };
}

/**
 * Task names this client has worked on before, most-recent first — the source
 * for the "what are you working on" picker. Drawn from actual tracked work so
 * the list reflects reality rather than every task ever created.
 */
export async function recentTaskTitles(clientId: string, limit = 40): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({
      name: tasks.name,
      lastUsed: sql<number>`max(${timeEntries.startMs})`.as('last_used'),
    })
    .from(timeEntries)
    .innerJoin(tasks, eq(tasks.id, timeEntries.taskId))
    .where(eq(timeEntries.clientId, clientId))
    .groupBy(tasks.name)
    .orderBy(desc(sql`max(${timeEntries.startMs})`))
    .limit(limit);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const key = r.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r.name);
  }
  return out;
}

/** Task-name suggestions per client, for the timer's picker. */
export async function taskSuggestionsByClient(): Promise<Record<string, string[]>> {
  const db = getDb();
  const rows = await db
    .select({
      clientId: timeEntries.clientId,
      name: tasks.name,
      lastUsed: sql<number>`max(${timeEntries.startMs})`.as('last_used'),
    })
    .from(timeEntries)
    .innerJoin(tasks, eq(tasks.id, timeEntries.taskId))
    .groupBy(timeEntries.clientId, tasks.name)
    .orderBy(desc(sql`max(${timeEntries.startMs})`));

  const out: Record<string, string[]> = {};
  for (const r of rows) {
    const list = (out[r.clientId] ??= []);
    if (list.length < 25 && !list.some((n) => n.toLowerCase() === r.name.toLowerCase())) list.push(r.name);
  }
  return out;
}
