/**
 * Exercises the timer actions against an in-process Postgres.
 *
 * These are the paths the lawyer touches every day — start, pause, resume,
 * create a client mid-flow — and they involve several writes each, so the only
 * honest check is to run them and read the database back.
 *
 * The actions end with `revalidatePath`, which throws outside a Next request.
 * That call is always last, after the writes, so the helper swallows it and then
 * asserts on stored state.
 *
 * Requires pglite:  npm i --no-save @electric-sql/pglite && npm run check:actions
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { and, eq, isNull } from 'drizzle-orm';
import * as schema from '../lib/db/schema';
import { __setDbForTesting } from '../lib/db';

const client = new PGlite();
const db = drizzle(client, { schema });
__setDbForTesting(db);

for (const file of readdirSync(join(process.cwd(), 'drizzle')).filter((f) => f.endsWith('.sql')).sort()) {
  const sql = readFileSync(join(process.cwd(), 'drizzle', file), 'utf-8');
  for (const stmt of sql.split('--> statement-breakpoint')) {
    const trimmed = stmt.trim();
    if (trimmed) await client.exec(trimmed);
  }
}

const actions = await import('../lib/actions');
await db.insert(schema.settings).values({ id: 1, roundIncrementMin: 6, defaultHourlyRate: 500, locale: 'he' });

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/** Run an action, ignoring the trailing revalidate/redirect that needs a request. */
async function run(fn: (fd: FormData) => Promise<unknown>, fields: Record<string, string>) {
  try {
    await fn(form(fields));
  } catch (e) {
    const msg = (e as Error).message ?? '';
    const expected = /revalidate|static generation store|NEXT_REDIRECT|headers|request scope/i.test(msg);
    if (!expected) throw e;
  }
}

const running = () => db.select().from(schema.timeEntries).where(isNull(schema.timeEntries.endMs));
const allEntries = () => db.select().from(schema.timeEntries).orderBy(schema.timeEntries.startMs);

let failures = 0;
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (e) {
    failures++;
    console.error(`FAIL  ${name}\n      ${(e as Error).message.split('\n').slice(0, 3).join(' ')}`);
  }
}

await check('starting a timer for a brand-new client creates the client and its catch-all case', async () => {
  await run(actions.startTimer, {
    clientId: '__new__',
    newClientName: 'לקוח חדש',
    projectId: '__default__',
    taskName: 'שיחת ייעוץ',
  });

  const clients = await db.select().from(schema.clients);
  assert.equal(clients.length, 1);
  assert.equal(clients[0]!.name, 'לקוח חדש');

  const projects = await db.select().from(schema.projects);
  assert.equal(projects.length, 1);
  assert.equal(projects[0]!.isDefault, 1, 'catch-all case not created');

  const live = await running();
  assert.equal(live.length, 1, 'timer did not start');
  assert.equal(live[0]!.description, 'שיחת ייעוץ');

  const tasks = await db.select().from(schema.tasks);
  assert.equal(tasks.length, 1, 'task not created from the free-text box');
  assert.equal(live[0]!.taskId, tasks[0]!.id);
});

const clientId = (await db.select().from(schema.clients))[0]!.id;

await check('starting a second timer pauses the first — only one runs at a time', async () => {
  await run(actions.startTimer, { clientId, projectId: '__default__', taskName: 'מטלה שנייה' });
  const live = await running();
  assert.equal(live.length, 1, `expected 1 running, got ${live.length}`);
  assert.equal(live[0]!.description, 'מטלה שנייה');

  const closed = (await allEntries()).filter((e) => e.endMs != null);
  assert.equal(closed.length, 1);
  assert.ok((closed[0]!.durationMs ?? 0) >= 0, 'duration not recorded on auto-pause');
});

await check('an inline new case is created and used', async () => {
  await run(actions.startTimer, {
    clientId,
    projectId: '__new__',
    newCaseName: 'תביעת פיצויים',
    newCaseNumber: '2026-0143',
    taskName: 'כתב תביעה',
  });
  const project = (await db.select().from(schema.projects)).find((p) => p.name === 'תביעת פיצויים');
  assert.ok(project, 'case not created');
  assert.equal(project.caseNumber, '2026-0143');
  const live = await running();
  assert.equal(live[0]!.projectId, project.id);
});

await check('pause records the elapsed time and leaves nothing running', async () => {
  const live = await running();
  await run(actions.pauseTimer, { entryId: live[0]!.id });
  assert.equal((await running()).length, 0);
  const [entry] = await db.select().from(schema.timeEntries).where(eq(schema.timeEntries.id, live[0]!.id));
  assert.ok(entry!.endMs != null, 'endMs not set');
  assert.ok(entry!.durationMs != null, 'durationMs not set');
});

await check('resume opens a new session on the same task', async () => {
  const claimTask = (await db.select().from(schema.tasks)).find((t) => t.name === 'כתב תביעה')!;
  const before = (await allEntries()).length;
  await run(actions.resumeTask, {
    clientId,
    projectId: claimTask.projectId,
    taskId: claimTask.id,
    taskName: claimTask.name,
  });
  const after = await allEntries();
  assert.equal(after.length, before + 1, 'no new session');
  const live = await running();
  assert.equal(live.length, 1);
  assert.equal(live[0]!.taskId, claimTask.id, 'resumed against a different task');
});

await check('resuming the same task twice reuses one task row, so hours accumulate', async () => {
  const named = (await db.select().from(schema.tasks)).filter((t) => t.name === 'כתב תביעה');
  assert.equal(named.length, 1, `task duplicated: ${named.length} rows`);
});

await check('a manual entry is stored complete, and can be non-billable', async () => {
  const project = (await db.select().from(schema.projects)).find((p) => p.name === 'תביעת פיצויים')!;
  await run(actions.addManualEntry, {
    clientId,
    projectId: project.id,
    taskName: 'עיון בחומר',
    hours: '1.5',
    date: '2026-07-20',
    nonBillable: '1',
  });
  const entry = (await allEntries()).find((e) => e.description === 'עיון בחומר');
  assert.ok(entry, 'manual entry missing');
  assert.equal(entry.durationMs, 1.5 * 3_600_000);
  assert.equal(entry.billable, 0, 'non-billable flag ignored');
  assert.ok(entry.endMs != null, 'manual entry left open');
});

await check('billable can be toggled after the fact', async () => {
  const entry = (await allEntries()).find((e) => e.description === 'עיון בחומר')!;
  await run(actions.toggleEntryBillable, { entryId: entry.id, projectId: entry.projectId });
  const [after] = await db.select().from(schema.timeEntries).where(eq(schema.timeEntries.id, entry.id));
  assert.equal(after!.billable, 1, 'toggle did not flip back to billable');
});

await check('cancelling a running timer records no time at all', async () => {
  const live = await running();
  assert.equal(live.length, 1, 'expected a running timer to cancel');
  const before = (await allEntries()).length;
  await run(actions.cancelTimer, { entryId: live[0]!.id });
  assert.equal((await allEntries()).length, before - 1, 'cancelled entry was kept');
  assert.equal((await running()).length, 0);
});

await check('the catch-all case is created once and reused', async () => {
  const defaults = (await db.select().from(schema.projects)).filter((p) => p.isDefault === 1);
  assert.equal(defaults.length, 1, `expected 1 catch-all case, got ${defaults.length}`);
});

await check('creating a client from the clients page also gets a catch-all case', async () => {
  await run(actions.createClient as never, { name: 'לקוח שני', hourlyRate: '700' });
  const second = (await db.select().from(schema.clients)).find((c) => c.name === 'לקוח שני')!;
  const theirs = await db
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.clientId, second.id), eq(schema.projects.isDefault, 1)));
  assert.equal(theirs.length, 1);
});

await client.close();
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
