import { eq } from 'drizzle-orm';
import { getDb } from './db';
import { clients, projects } from './db/schema';
import { caseTotals, clientTotals, clientAmount, effectiveRate } from './queries';
import { getSettings, localeOf } from './settings';
import { sendUsageAlert } from './email';
import { round2 } from './util';

/**
 * Usage alerts let a client say "tell me when this reaches 20 hours" or "…when
 * it reaches ₪10,000" and hear about it without asking. Thresholds exist per
 * case and per client, for hours and for money.
 *
 * Each threshold fires once: the value that triggered it is written to
 * `alertNotified*`, and only moving the threshold re-arms it. The mark is
 * written *before* the email so two racing timer stops cannot double-send.
 *
 * Never throws — a mail outage must not stop someone pausing their timer.
 */
export async function checkAlerts(projectId: string): Promise<void> {
  try {
    const db = getDb();
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!project) return;
    const [client] = await db.select().from(clients).where(eq(clients.id, project.clientId));
    if (!client) return;

    const s = await getSettings();
    const locale = localeOf(s);
    const caseName = [project.caseNumber, project.name].filter(Boolean).join(' · ');

    // ---- Case-level ----
    const totals = await caseTotals(project.id, s.roundIncrementMin);
    const rate = effectiveRate(project, client, s.defaultHourlyRate);
    const caseCharge = round2(totals.billedHours * rate);

    const caseHoursDue =
      project.alertThresholdHours != null &&
      project.alertThresholdHours > 0 &&
      totals.hours >= project.alertThresholdHours &&
      (project.alertNotifiedHours == null || project.alertNotifiedHours < project.alertThresholdHours);

    if (caseHoursDue) {
      await db
        .update(projects)
        .set({ alertNotifiedHours: project.alertThresholdHours, alertNotifiedAt: new Date() })
        .where(eq(projects.id, project.id));
      await sendUsageAlert({
        client,
        scope: caseName,
        kind: 'hours',
        value: totals.hours,
        threshold: project.alertThresholdHours!,
        currency: client.currency,
        settings: s,
        locale,
      });
    }

    const caseAmountDue =
      project.alertThresholdAmount != null &&
      project.alertThresholdAmount > 0 &&
      caseCharge >= project.alertThresholdAmount &&
      (project.alertNotifiedAmount == null || project.alertNotifiedAmount < project.alertThresholdAmount);

    if (caseAmountDue) {
      await db
        .update(projects)
        .set({ alertNotifiedAmount: project.alertThresholdAmount, alertNotifiedAt: new Date() })
        .where(eq(projects.id, project.id));
      await sendUsageAlert({
        client,
        scope: caseName,
        kind: 'amount',
        value: caseCharge,
        threshold: project.alertThresholdAmount!,
        currency: client.currency,
        settings: s,
        locale,
      });
    }

    // ---- Client-level (across every case) ----
    const wantsClientHours = client.alertThresholdHours != null && client.alertThresholdHours > 0;
    const wantsClientAmount = client.alertThresholdAmount != null && client.alertThresholdAmount > 0;
    if (!wantsClientHours && !wantsClientAmount) return;

    const cTotals = wantsClientHours ? await clientTotals(client.id, s.roundIncrementMin) : null;
    const cAmount = wantsClientAmount ? await clientAmount(client.id) : 0;

    if (
      cTotals &&
      cTotals.hours >= client.alertThresholdHours! &&
      (client.alertNotifiedHours == null || client.alertNotifiedHours < client.alertThresholdHours!)
    ) {
      await db
        .update(clients)
        .set({ alertNotifiedHours: client.alertThresholdHours, alertNotifiedAt: new Date() })
        .where(eq(clients.id, client.id));
      await sendUsageAlert({
        client,
        scope: null,
        kind: 'hours',
        value: cTotals.hours,
        threshold: client.alertThresholdHours!,
        currency: client.currency,
        settings: s,
        locale,
      });
    }

    if (
      wantsClientAmount &&
      cAmount >= client.alertThresholdAmount! &&
      (client.alertNotifiedAmount == null || client.alertNotifiedAmount < client.alertThresholdAmount!)
    ) {
      await db
        .update(clients)
        .set({ alertNotifiedAmount: client.alertThresholdAmount, alertNotifiedAt: new Date() })
        .where(eq(clients.id, client.id));
      await sendUsageAlert({
        client,
        scope: null,
        kind: 'amount',
        value: cAmount,
        threshold: client.alertThresholdAmount!,
        currency: client.currency,
        settings: s,
        locale,
      });
    }
  } catch (e) {
    console.error('usage alert failed', e);
  }
}
