/**
 * Runs the real query layer against an in-process Postgres.
 *
 * Several of these queries are hand-written SQL (grouped aggregates over
 * coalesced task names, for instance) that TypeScript cannot check. A mistake
 * there does not fail the build — it fails as a 500 on the dashboard, in front
 * of the user. This proves the SQL executes and returns the right shape against
 * the same migrations that ship.
 *
 * Requires pglite, which is not a runtime dependency:
 *   npm i --no-save @electric-sql/pglite
 *   npm run check:queries
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../lib/db/schema';
import { __setDbForTesting } from '../lib/db';

const MIGRATIONS = join(process.cwd(), 'drizzle');
const HOUR = 3_600_000;

const client = new PGlite();
const db = drizzle(client, { schema });
__setDbForTesting(db);

// Apply the shipped migrations, statement by statement.
for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
  const sql = readFileSync(join(MIGRATIONS, file), 'utf-8');
  for (const stmt of sql.split('--> statement-breakpoint')) {
    const trimmed = stmt.trim();
    if (trimmed) await client.exec(trimmed);
  }
  console.log(`migrated ${file}`);
}

// Import after the seam is set so module-level state cannot capture a real client.
const q = await import('../lib/queries');
const { getSettings } = await import('../lib/settings');

await db.insert(schema.settings).values({ id: 1, roundIncrementMin: 6, defaultHourlyRate: 500 });
await db.insert(schema.clients).values({ id: 'c1', name: 'חברת כהן', currency: 'ILS', hourlyRate: 600 });
await db.insert(schema.projects).values([
  { id: 'p0', clientId: 'c1', name: 'כללי', isDefault: 1 },
  { id: 'p1', clientId: 'c1', name: 'תביעת פיצויים', caseNumber: '2026-0143', alertThresholdHours: 2 },
]);
await db.insert(schema.tasks).values([
  { id: 't1', projectId: 'p1', name: 'כתב תביעה' },
  { id: 't2', projectId: 'p0', name: 'ייעוץ' },
]);

const base = Date.UTC(2026, 6, 14, 6, 0, 0);
await db.insert(schema.timeEntries).values([
  // Two sittings on the same task, two hours apart — a pause gap.
  { id: 'e1', clientId: 'c1', projectId: 'p1', taskId: 't1', description: 'כתב תביעה', startMs: base, endMs: base + HOUR, durationMs: HOUR },
  { id: 'e2', clientId: 'c1', projectId: 'p1', taskId: 't1', description: 'כתב תביעה', startMs: base + 3 * HOUR, endMs: base + 3.5 * HOUR, durationMs: 0.5 * HOUR },
  // Non-billable time, and a session on the catch-all case.
  { id: 'e3', clientId: 'c1', projectId: 'p1', taskId: 't1', startMs: base + 5 * HOUR, endMs: base + 6 * HOUR, durationMs: HOUR, billable: 0 },
  { id: 'e4', clientId: 'c1', projectId: 'p0', taskId: 't2', description: 'ייעוץ', startMs: base + 8 * HOUR, endMs: base + 8.25 * HOUR, durationMs: 0.25 * HOUR },
]);

let failures = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (e) {
    failures++;
    console.error(`FAIL  ${name}\n      ${(e as Error).message.split('\n').slice(0, 3).join(' ')}`);
  }
}

await check('getSettings creates/loads the singleton', async () => {
  const s = await getSettings();
  assert.equal(s.roundIncrementMin, 6);
});

await check('resumableTasks groups sessions by task (raw SQL)', async () => {
  const rows = await q.resumableTasks(10);
  assert.ok(rows.length >= 2, `expected >=2 rows, got ${rows.length}`);
  const claim = rows.find((r) => r.taskName === 'כתב תביעה');
  assert.ok(claim, 'missing grouped task');
  // 1h + 0.5h + 1h non-billable all belong to the same task.
  assert.equal(claim.totalMs, 2.5 * HOUR);
  assert.equal(claim.projectId, 'p1');
  assert.ok(claim.lastEndMs > 0);
});

await check('getClientsTree returns cases and previous task names (raw SQL)', async () => {
  const tree = await q.getClientsTree();
  assert.equal(tree.length, 1);
  const node = tree[0]!;
  assert.equal(node.projects.length, 2);
  assert.equal(node.projects[0]!.isDefault, true, 'default case should sort first');
  assert.ok(node.taskNames.includes('כתב תביעה'));
});

await check('caseTotals splits actual / billed / non-billable', async () => {
  const totals = await q.caseTotals('p1', 6);
  assert.equal(totals.hours, 2.5); // 1 + 0.5 + 1
  assert.equal(totals.billedHours, 1.5); // non-billable excluded
  assert.equal(totals.nonBillableHours, 1);
});

await check('buildReport nests case -> task -> session with pause gaps', async () => {
  const report = await q.buildReport({ clientId: 'c1', fromMs: 0, toMs: 0, allTime: true });
  assert.ok(report, 'no report');
  assert.equal(report.cases.length, 2);
  const claimCase = report.cases.find((c) => c.projectId === 'p1')!;
  const task = claimCase.tasks.find((t) => t.taskName === 'כתב תביעה')!;
  assert.equal(task.sessions.length, 3);
  assert.equal(task.sessions[0]!.gapMsBefore, null);
  assert.equal(task.sessions[1]!.gapMsBefore, 2 * HOUR, 'pause gap between sittings');
  assert.equal(report.totalHours, 2.75);
  assert.equal(report.totalNonBillableHours, 1);
  // Rate resolution: client rate 600 applies to both cases.
  assert.equal(claimCase.rate, 600);
});

await check('billed hours exceed actual hours by design (rounding up)', async () => {
  const report = await q.buildReport({ clientId: 'c1', fromMs: 0, toMs: 0, allTime: true });
  // 0.25h rounds to 0.3h on a 6-minute unit, so billed > actual overall.
  assert.ok(report!.totalBilledHours >= report!.totalHours - report!.totalNonBillableHours);
});

await check('report window filters by start time', async () => {
  const empty = await q.buildReport({ clientId: 'c1', fromMs: 0, toMs: 1000 });
  assert.equal(empty!.cases.length, 0);
  assert.equal(empty!.totalHours, 0);
});

await check('activeCasesWithHours computes charge per case', async () => {
  const rows = await q.activeCasesWithHours();
  assert.equal(rows.length, 2);
  const claim = rows.find((r) => r.project.id === 'p1')!;
  assert.equal(claim.amount, 900); // 1.5 billed h x 600
});

await check('clientAmount sums every case at its own rate', async () => {
  const amount = await q.clientAmount('c1');
  assert.equal(amount, 1080); // 900 + (0.3h x 600)
});

await check('reportSessions flattens in chronological order', async () => {
  const report = await q.buildReport({ clientId: 'c1', fromMs: 0, toMs: 0, allTime: true });
  const rows = q.reportSessions(report!);
  assert.equal(rows.length, 4);
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i]!.session.startMs >= rows[i - 1]!.session.startMs, 'not sorted');
  }
});

await check('getProjectDetail and getClientDetail load', async () => {
  const detail = await q.getProjectDetail('p1');
  assert.ok(detail);
  assert.equal(detail.hours, 2.5);
  const cd = await q.getClientDetail('c1');
  assert.equal(cd!.cases.length, 2);
});

await client.close();
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
