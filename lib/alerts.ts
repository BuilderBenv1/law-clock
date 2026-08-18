import { eq } from 'drizzle-orm';
import { getDb } from './db';
import { clients, projects } from './db/schema';
import { caseHours, caseBilledAmount } from './queries';
import { getSettings, localeOf } from './settings';
import { sendThresholdAlert, sendAmountAlert } from './email';

/**
 * After work is logged on a case, check whether it has crossed either of its
 * alert thresholds — hours or money — and if so email the client, once each.
 * The `alertNotified*` columns record the threshold already fired on, so raising
 * a threshold re-arms it but the same one never fires twice. Never throws: a
 * failed email must not break stopping a timer.
 */
export async function checkThreshold(projectId: string): Promise<void> {
  await Promise.all([checkHoursThreshold(projectId), checkAmountThreshold(projectId)]);
}

async function checkHoursThreshold(projectId: string): Promise<void> {
  try {
    const db = getDb();
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!project || project.alertThresholdHours == null || project.alertThresholdHours <= 0) return;

    const threshold = project.alertThresholdHours;
    // Already alerted at this (or a higher) threshold? Nothing to do.
    if (project.alertNotifiedHours != null && project.alertNotifiedHours >= threshold) return;

    const hours = await caseHours(projectId);
    if (hours < threshold) return;

    const [client] = await db.select().from(clients).where(eq(clients.id, project.clientId));
    if (!client) return;
    const s = await getSettings();

    // Mark first (best-effort dedupe even if two stops race), then send.
    await db.update(projects).set({ alertNotifiedHours: threshold, alertNotifiedAt: new Date() }).where(eq(projects.id, projectId));
    await sendThresholdAlert(client, project, hours, threshold, s, localeOf(s));
  } catch (e) {
    console.error('hours threshold alert failed', e);
  }
}

/** "You asked to be told when you'd spent X — here is that reminder." */
async function checkAmountThreshold(projectId: string): Promise<void> {
  try {
    const db = getDb();
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!project || project.alertThresholdAmount == null || project.alertThresholdAmount <= 0) return;

    const threshold = project.alertThresholdAmount;
    if (project.alertNotifiedAmount != null && project.alertNotifiedAmount >= threshold) return;

    const amount = await caseBilledAmount(projectId);
    if (amount < threshold) return;

    const [client] = await db.select().from(clients).where(eq(clients.id, project.clientId));
    if (!client) return;
    const s = await getSettings();

    await db
      .update(projects)
      .set({ alertNotifiedAmount: threshold, alertAmountNotifiedAt: new Date() })
      .where(eq(projects.id, projectId));
    await sendAmountAlert(client, project, amount, threshold, s, localeOf(s));
  } catch (e) {
    console.error('amount threshold alert failed', e);
  }
}
