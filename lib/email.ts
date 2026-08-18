import { Resend } from 'resend';
import type { Client, Settings } from './db/schema';
import { reportSessions, type ReportData } from './queries';
import type { Locale } from './i18n';
import { t, monthLabel } from './i18n';
import { money, formatDate } from './format';
import type { InvoiceDetail } from './invoice-service';
import { renderInvoiceHtml } from './invoice-doc';

function resend(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY is not set');
  return new Resend(key);
}
function fromAddress(): string {
  return process.env.EMAIL_FROM || 'onboarding@resend.dev';
}
function esc(s: string | null | undefined): string {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}
function shell(locale: Locale, inner: string): string {
  const dir = locale === 'he' ? 'rtl' : 'ltr';
  const align = locale === 'he' ? 'right' : 'left';
  return `<div dir="${dir}" style="font-family:'Segoe UI',Arial,sans-serif;color:#1a2233;max-width:600px;margin:0 auto;padding:24px;text-align:${align}">${inner}</div>`;
}

export interface UsageAlertArgs {
  client: Client;
  /** Case label, or null when the threshold is client-wide. */
  scope: string | null;
  kind: 'hours' | 'amount';
  value: number;
  threshold: number;
  currency: string;
  settings: Settings;
  locale: Locale;
}

/**
 * Tell the client they have reached a limit they themselves asked to be warned
 * about. The wording leads with that fact — this is a reminder they requested,
 * not an unexpected bill — and states the current figure against the threshold.
 */
export async function sendUsageAlert(args: UsageAlertArgs): Promise<string | null> {
  const { client, scope, kind, value, threshold, currency, settings: s, locale } = args;
  const to = client.email || s.reportEmail || s.firmEmail;
  if (!to) return null;

  const fmt = (n: number) => (kind === 'amount' ? money(n, currency, locale) : n.toFixed(2));
  const scopeHe = scope ? `בתיק <strong>${esc(scope)}</strong>` : 'בכל התיקים המתנהלים עבורך';
  const scopeEn = scope ? `on <strong>${esc(scope)}</strong>` : 'across all of your matters';

  const heBody = `
    <h2 style="margin:0 0 12px">${kind === 'amount' ? 'עדכון חיוב' : 'עדכון שעות'}</h2>
    <p>שלום ${esc(client.name)},</p>
    <p>ביקשת לקבל עדכון כאשר ${kind === 'amount' ? 'החיוב' : 'מספר השעות'} ${scopeHe} ${
      kind === 'amount' ? 'יגיע ל' : 'יגיעו ל'
    }<strong>${esc(fmt(threshold))}</strong> — זוהי התזכורת.</p>
    <p style="background:#f4f7ff;border:1px solid #e4ebf7;border-radius:10px;padding:14px 16px;font-size:15px">
      נכון להיום נצברו <strong>${esc(fmt(value))}</strong>${kind === 'hours' ? ' שעות' : ''}.
    </p>
    <p>נשמח לעמוד לרשותך לכל שאלה או הבהרה, ולשלוח פירוט מלא של השעות לפי בקשה.</p>
    <p style="margin-top:20px">בברכה,<br>${esc(s.firmName)}</p>`;

  const enBody = `
    <h2 style="margin:0 0 12px">${kind === 'amount' ? 'Billing update' : 'Hours update'}</h2>
    <p>Hello ${esc(client.name)},</p>
    <p>You asked to be told when ${kind === 'amount' ? 'billing' : 'time'} ${scopeEn} reached
      <strong>${esc(fmt(threshold))}</strong> — here is that reminder.</p>
    <p style="background:#f4f7ff;border:1px solid #e4ebf7;border-radius:10px;padding:14px 16px;font-size:15px">
      The current total is <strong>${esc(fmt(value))}</strong>${kind === 'hours' ? ' hours' : ''}.
    </p>
    <p>We are happy to answer any questions, and can send a full breakdown of the hours on request.</p>
    <p style="margin-top:20px">Best regards,<br>${esc(s.firmName)}</p>`;

  const subject =
    locale === 'he'
      ? kind === 'amount'
        ? `עדכון חיוב — ${fmt(value)}${scope ? ` · ${scope}` : ''}`
        : `עדכון שעות — ${value.toFixed(1)} ש'${scope ? ` · ${scope}` : ''}`
      : kind === 'amount'
        ? `Billing update — ${fmt(value)}${scope ? ` · ${scope}` : ''}`
        : `Hours update — ${value.toFixed(1)}h${scope ? ` · ${scope}` : ''}`;

  const { error } = await resend().emails.send({
    from: fromAddress(),
    to,
    subject,
    html: shell(locale, locale === 'he' ? heBody : enBody),
  });
  if (error) throw new Error(`Resend send failed: ${error.message ?? 'unknown error'}`);
  return to;
}

/** Email an invoice to a recipient — the printable invoice doc is the body. */
export async function sendInvoiceEmail(detail: InvoiceDetail, to: string, locale: Locale): Promise<void> {
  const inv = detail.invoice;
  const intro =
    locale === 'he'
      ? `<p dir="rtl">שלום ${esc(inv.clientName || '')},</p><p dir="rtl">מצורפת חשבונית ${esc(inv.number)} מ${esc(inv.firmName)}.</p>`
      : `<p>Hello ${esc(inv.clientName || '')},</p><p>Please find invoice ${esc(inv.number)} from ${esc(inv.firmName)} below.</p>`;
  const { error } = await resend().emails.send({
    from: fromAddress(),
    to,
    subject: locale === 'he' ? `חשבונית ${inv.number} — ${inv.firmName}` : `Invoice ${inv.number} from ${inv.firmName}`,
    html: `${intro}${renderInvoiceHtml(detail, locale)}`,
  });
  if (error) throw new Error(`Resend send failed: ${error.message ?? 'unknown error'}`);
}

export interface MonthlyClientReport {
  client: Client;
  report: ReportData;
}

/** Combined CSV across every client's sessions for the month (Excel-friendly). */
export function monthlyCombinedCsv(reports: MonthlyClientReport[], s: Settings, locale: Locale): string {
  const header = [
    t(locale, 'client'),
    t(locale, 'case'),
    t(locale, 'date'),
    t(locale, 'task'),
    t(locale, 'actualHours'),
    t(locale, 'billedHours'),
    t(locale, 'billable'),
  ];
  const cell = (v: string | number) => {
    const str = String(v ?? '');
    return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const rows = [header.map(cell).join(',')];
  for (const { client, report } of reports) {
    for (const row of reportSessions(report)) {
      rows.push(
        [
          client.name,
          [row.caseNumber, row.caseName].filter(Boolean).join(' '),
          formatDate(row.session.startMs, s.timezone, locale),
          row.taskName,
          row.session.hours.toFixed(2),
          row.session.billedHours.toFixed(2),
          row.session.billable ? t(locale, 'billable') : t(locale, 'nonBillable'),
        ]
          .map(cell)
          .join(','),
      );
    }
  }
  return '﻿' + rows.join('\r\n');
}

/**
 * Send the automatic monthly report to the configured address: a summary table
 * (hours + amount per client) with a combined CSV of all sessions attached.
 */
export async function sendMonthlyReport(
  to: string,
  monthKeyStr: string,
  reports: MonthlyClientReport[],
  s: Settings,
  locale: Locale,
): Promise<void> {
  const label = monthLabel(monthKeyStr, locale);
  const totalHours = reports.reduce((a, r) => a + r.report.totalHours, 0);
  const totalAmount = reports.reduce((a, r) => a + r.report.amount, 0);

  const rows = reports
    .map(
      (r) =>
        `<tr><td style="padding:6px 8px;border-bottom:1px solid #eef1f6">${esc(r.client.name)}</td>
         <td style="padding:6px 8px;border-bottom:1px solid #eef1f6;text-align:center">${r.report.totalHours.toFixed(2)}</td>
         <td style="padding:6px 8px;border-bottom:1px solid #eef1f6;text-align:center">${r.report.totalBilledHours.toFixed(2)}</td>
         <td style="padding:6px 8px;border-bottom:1px solid #eef1f6;text-align:center">${esc(money(r.report.amount, r.report.currency, locale))}</td></tr>`,
    )
    .join('');

  const heInner = `
    <h2 style="margin:0 0 6px">דוח שעות חודשי — ${esc(label)}</h2>
    <p style="color:#6b7688">${esc(s.firmName)}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:12px">
      <thead><tr>
        <th style="text-align:right;padding:6px 8px;border-bottom:2px solid #e4ebf7">לקוח</th>
        <th style="padding:6px 8px;border-bottom:2px solid #e4ebf7">שעות בפועל</th>
        <th style="padding:6px 8px;border-bottom:2px solid #e4ebf7">לחיוב</th>
        <th style="padding:6px 8px;border-bottom:2px solid #e4ebf7">סכום</th>
      </tr></thead>
      <tbody>${rows || `<tr><td colspan="4" style="padding:10px;color:#6b7688">אין נתונים לחודש זה</td></tr>`}</tbody>
      <tfoot><tr>
        <td style="padding:8px;font-weight:700">סה״כ</td>
        <td style="padding:8px;text-align:center;font-weight:700">${totalHours.toFixed(2)}</td>
        <td></td>
        <td style="padding:8px;text-align:center;font-weight:700">${esc(money(totalAmount, s.defaultCurrency, locale))}</td>
      </tr></tfoot>
    </table>
    <p style="color:#6b7688;font-size:13px;margin-top:16px">קובץ CSV מפורט מצורף להודעה זו.</p>`;

  const enInner = `
    <h2 style="margin:0 0 6px">Monthly hours report — ${esc(label)}</h2>
    <p style="color:#6b7688">${esc(s.firmName)}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:12px">
      <thead><tr>
        <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e4ebf7">Client</th>
        <th style="padding:6px 8px;border-bottom:2px solid #e4ebf7">Actual</th>
        <th style="padding:6px 8px;border-bottom:2px solid #e4ebf7">Billed</th>
        <th style="padding:6px 8px;border-bottom:2px solid #e4ebf7">Amount</th>
      </tr></thead>
      <tbody>${rows || `<tr><td colspan="4" style="padding:10px;color:#6b7688">No data for this month</td></tr>`}</tbody>
      <tfoot><tr>
        <td style="padding:8px;font-weight:700">Total</td>
        <td style="padding:8px;text-align:center;font-weight:700">${totalHours.toFixed(2)}</td>
        <td></td>
        <td style="padding:8px;text-align:center;font-weight:700">${esc(money(totalAmount, s.defaultCurrency, locale))}</td>
      </tr></tfoot>
    </table>
    <p style="color:#6b7688;font-size:13px;margin-top:16px">A detailed CSV file is attached.</p>`;

  const csv = monthlyCombinedCsv(reports, s, locale);
  const { error } = await resend().emails.send({
    from: fromAddress(),
    to,
    subject: locale === 'he' ? `דוח שעות חודשי — ${label}` : `Monthly hours report — ${label}`,
    html: shell(locale, locale === 'he' ? heInner : enInner),
    attachments: [{ filename: `report-${monthKeyStr}.csv`, content: Buffer.from(csv, 'utf-8') }],
  });
  if (error) throw new Error(`Resend send failed: ${error.message ?? 'unknown error'}`);
}
