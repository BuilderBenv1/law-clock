import { reportSessions, type ReportData } from './queries';
import type { Locale } from './i18n';
import { t } from './i18n';
import { formatDate, money } from './format';
import { formatGap, formatTimeOfDay } from './time';
import type { Settings } from './db/schema';

/** CSV-escape a cell (quote when it contains a comma, quote, or newline). */
function csvCell(v: string | number): string {
  const s = String(v ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Build a UTF-8 CSV (with BOM, so Excel opens Hebrew correctly) of every work
 * session in the report, including start/end times and the break before each,
 * plus totals.
 */
export function reportToCsv(report: ReportData, s: Settings, locale: Locale): string {
  const header = [
    t(locale, 'date'),
    t(locale, 'case'),
    t(locale, 'task'),
    t(locale, 'startEnd'),
    t(locale, 'pauseGap'),
    t(locale, 'actualHours'),
    t(locale, 'billedHours'),
    t(locale, 'billable'),
  ];
  const lines = [header.map(csvCell).join(',')];

  for (const row of reportSessions(report)) {
    const se = row.session;
    const times =
      se.endMs != null
        ? `${formatTimeOfDay(se.startMs, s.timezone)}-${formatTimeOfDay(se.endMs, s.timezone)}`
        : formatTimeOfDay(se.startMs, s.timezone);
    lines.push(
      [
        formatDate(se.startMs, s.timezone, locale),
        [row.caseNumber, row.caseName].filter(Boolean).join(' '),
        row.taskName,
        times,
        se.gapMsBefore != null && se.gapMsBefore >= 60_000 ? formatGap(se.gapMsBefore) : '',
        se.hours.toFixed(2),
        se.billedHours.toFixed(2),
        se.billable ? t(locale, 'billable') : t(locale, 'nonBillable'),
      ]
        .map(csvCell)
        .join(','),
    );
  }

  lines.push('');
  lines.push(
    [t(locale, 'total'), '', '', '', '', report.totalHours.toFixed(2), report.totalBilledHours.toFixed(2), ''].map(csvCell).join(','),
  );
  lines.push(
    [t(locale, 'amount'), '', '', '', '', '', money(report.amount, report.currency, locale), ''].map(csvCell).join(','),
  );
  return '﻿' + lines.join('\r\n');
}

function esc(x: string | null | undefined): string {
  return String(x ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

/**
 * The on-screen / printable statement. Mirrors the PDF: totals, then cases, then
 * the tasks inside each case, then a chronological log showing pause gaps.
 */
export function reportToHtml(
  report: ReportData,
  s: Settings,
  locale: Locale,
  opts: { standalone?: boolean } = {},
): string {
  const rtl = locale === 'he';
  const dirAttr = rtl ? 'rtl' : 'ltr';
  const align = rtl ? 'right' : 'left';
  const numAlign = rtl ? 'left' : 'right';
  const period = report.allTime
    ? t(locale, 'allTime')
    : `${formatDate(report.fromMs, s.timezone, locale)} – ${formatDate(report.toMs - 1, s.timezone, locale)}`;
  const scope = report.project
    ? [report.project.caseNumber, report.project.name].filter(Boolean).join(' · ')
    : t(locale, 'allCases');

  const caseRows = report.cases
    .map(
      (c) => `<tr>
      <td>${esc([c.caseNumber, c.caseName].filter(Boolean).join(' · '))}</td>
      <td class="num">${c.tasks.reduce((n, task) => n + task.sessions.length, 0)}</td>
      <td class="num">${c.hours.toFixed(2)}</td>
      <td class="num">${c.billedHours.toFixed(2)}</td>
      <td class="num">${esc(money(c.amount, report.currency, locale))}</td>
    </tr>`,
    )
    .join('');

  const caseSections = report.cases
    .map(
      (c) => `
    <h3>${esc(t(locale, 'case'))}: ${esc([c.caseNumber, c.caseName].filter(Boolean).join(' · '))}</h3>
    <table>
      <thead><tr>
        <th>${esc(t(locale, 'task'))}</th>
        <th class="num">${esc(t(locale, 'segments'))}</th>
        <th class="num">${esc(t(locale, 'actualHours'))}</th>
        <th class="num">${esc(t(locale, 'billedHours'))}</th>
        <th class="num">${esc(t(locale, 'amount'))}</th>
      </tr></thead>
      <tbody>${c.tasks
        .map(
          (task) => `<tr>
          <td>${esc(task.taskName)}${task.nonBillableHours > 0 ? ` <span class="tag">${esc(t(locale, 'nonBillable'))}</span>` : ''}</td>
          <td class="num">${task.sessions.length}</td>
          <td class="num">${task.hours.toFixed(2)}</td>
          <td class="num">${task.billedHours.toFixed(2)}</td>
          <td class="num">${esc(money(task.amount, report.currency, locale))}</td>
        </tr>`,
        )
        .join('')}</tbody>
    </table>`,
    )
    .join('');

  const logRows = reportSessions(report)
    .map((row) => {
      const se = row.session;
      const times =
        se.endMs != null
          ? `${formatTimeOfDay(se.startMs, s.timezone)}–${formatTimeOfDay(se.endMs, s.timezone)}`
          : formatTimeOfDay(se.startMs, s.timezone);
      const gap =
        se.gapMsBefore != null && se.gapMsBefore >= 60_000
          ? `<tr class="gap"><td colspan="5">${esc(t(locale, 'pauseGap'))} — ${esc(formatGap(se.gapMsBefore))}</td></tr>`
          : '';
      return `${gap}<tr${se.billable ? '' : ' class="muted-row"'}>
        <td>${esc(formatDate(se.startMs, s.timezone, locale))}</td>
        <td>${esc(times)}</td>
        <td>${esc(se.description || row.taskName)}</td>
        <td class="num">${se.hours.toFixed(2)}</td>
        <td class="num">${se.billable ? se.billedHours.toFixed(2) : '—'}</td>
      </tr>`;
    })
    .join('');

  const body = `
  <div class="report" dir="${dirAttr}" style="text-align:${align}">
    <div class="head">
      <div>
        ${s.logoUrl ? `<img src="${esc(s.logoUrl)}" alt="" style="max-height:56px;max-width:200px;object-fit:contain;margin-bottom:6px" />` : ''}
        <h1>${esc(s.firmName)}</h1>
        <div class="muted">${[s.firmAddress, s.firmPhone, s.firmEmail].filter((x): x is string => !!x).map(esc).join(' · ')}</div>
      </div>
      <div class="meta">
        <div class="doctitle">${esc(t(locale, 'statement'))}</div>
        <div class="muted small">${esc(period)}</div>
        <div class="muted small">${esc(t(locale, 'generatedOn'))} ${esc(formatDate(Date.now(), s.timezone, locale))}</div>
      </div>
    </div>

    <div class="parties">
      <div>
        <div class="label">${esc(t(locale, 'billTo'))}</div>
        <div class="strong">${esc(report.client.name)}</div>
      </div>
      <div class="end"><div class="label">${esc(t(locale, 'case'))}</div><div class="strong">${esc(scope)}</div></div>
    </div>

    <div class="totals">
      <div class="tile"><span>${esc(t(locale, 'hourlyRate'))}</span><strong>${esc(money(report.rate, report.currency, locale))}</strong></div>
      <div class="tile"><span>${esc(t(locale, 'actualHours'))}</span><strong>${report.totalHours.toFixed(2)}</strong></div>
      <div class="tile"><span>${esc(t(locale, 'billedHours'))}</span><strong>${report.totalBilledHours.toFixed(2)}</strong></div>
      <div class="tile accent"><span>${esc(t(locale, 'totalDue'))}</span><strong>${esc(money(report.amount, report.currency, locale))}</strong></div>
    </div>
    <p class="note">${esc(t(locale, 'roundingNote'))} (${esc(t(locale, 'roundingUnit'))}: ${report.roundIncrementMin} ${esc(t(locale, 'minutes'))})</p>

    ${
      report.cases.length === 0
        ? `<p class="muted">${esc(t(locale, 'noData'))}</p>`
        : `
    <h2>${esc(t(locale, 'byCase'))}</h2>
    <table>
      <thead><tr>
        <th>${esc(t(locale, 'case'))}</th>
        <th class="num">${esc(t(locale, 'segments'))}</th>
        <th class="num">${esc(t(locale, 'actualHours'))}</th>
        <th class="num">${esc(t(locale, 'billedHours'))}</th>
        <th class="num">${esc(t(locale, 'amount'))}</th>
      </tr></thead>
      <tbody>${caseRows}</tbody>
      <tfoot><tr>
        <td>${esc(t(locale, 'total'))}</td>
        <td class="num">${report.sessionCount}</td>
        <td class="num">${report.totalHours.toFixed(2)}</td>
        <td class="num">${report.totalBilledHours.toFixed(2)}</td>
        <td class="num">${esc(money(report.amount, report.currency, locale))}</td>
      </tr></tfoot>
    </table>

    ${caseSections}

    <h2>${esc(t(locale, 'activityLog'))}</h2>
    <table>
      <thead><tr>
        <th>${esc(t(locale, 'date'))}</th>
        <th>${esc(t(locale, 'startEnd'))}</th>
        <th>${esc(t(locale, 'task'))}</th>
        <th class="num">${esc(t(locale, 'duration'))}</th>
        <th class="num">${esc(t(locale, 'billedHours'))}</th>
      </tr></thead>
      <tbody>${logRows}</tbody>
    </table>`
    }
  </div>`;

  const css = `
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, 'Helvetica Neue', sans-serif; color: #16202f; margin: 0; background:#f4f6fb; }
    .report { max-width: 860px; margin: 24px auto; background:#fff; padding: 36px; border-radius: 12px; }
    .head { display:flex; justify-content:space-between; align-items:flex-start; gap:20px; border-bottom:2px solid #8c6b3f; padding-bottom:14px; margin-bottom:16px; }
    .meta { text-align:${numAlign}; }
    .doctitle { font-size:20px; font-weight:800; }
    h1 { font-size: 17px; margin: 0 0 4px; }
    h2 { font-size: 14px; margin: 24px 0 8px; border-inline-start:3px solid #8c6b3f; padding-inline-start:8px; }
    h3 { font-size: 12.5px; margin: 18px 0 6px; color:#33415c; }
    .muted { color:#6b7688; font-size: 12px; }
    .small { font-size: 11px; }
    .note { color:#6b7688; font-size:11px; margin:10px 0 0; }
    .label { font-size:10px; text-transform:uppercase; letter-spacing:.05em; color:#8a94a6; }
    .strong { font-weight:700; font-size:14px; }
    .parties { display:flex; justify-content:space-between; gap:16px; margin:16px 0 20px; }
    .end { text-align:${numAlign}; }
    .totals { display:flex; gap:10px; flex-wrap:wrap; }
    .tile { flex:1; min-width:130px; background:#f4f7fb; border:1px solid #e3e7ee; border-radius:10px; padding:11px 14px; }
    .tile.accent { background:#faf7f2; border-color:#8c6b3f; }
    .tile span { display:block; font-size:11px; color:#6b7688; margin-bottom:3px; }
    .tile strong { font-size:18px; }
    table { width:100%; border-collapse:collapse; font-size:12px; margin-bottom:6px; }
    th { color:#6b7688; font-weight:600; font-size:11px; padding:7px 8px; border-bottom:2px solid #e3e7ee; text-align:${align}; }
    td { padding:7px 8px; border-bottom:1px solid #eef1f6; }
    tfoot td { font-weight:700; border-top:2px solid #e3e7ee; }
    .num { text-align:${numAlign}; font-variant-numeric: tabular-nums; }
    .gap td { background:#f6f8fc; color:#8a94a6; font-size:10.5px; padding:4px 8px; }
    .muted-row td { color:#8a94a6; }
    .tag { font-size:10px; color:#8a94a6; border:1px solid #e3e7ee; border-radius:999px; padding:1px 6px; }
    @media print { body { background:#fff; } .report { box-shadow:none; margin:0; max-width:none; padding:0; } .noprint { display:none; } }
  `;

  if (!opts.standalone) return `<style>${css}</style>${body}`;

  return `<!doctype html><html lang="${locale}" dir="${dirAttr}"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${esc(t(locale, 'statement'))} — ${esc(report.client.name)}</title>
    <style>${css}
      .bar { max-width:860px; margin: 14px auto 0; display:flex; gap:8px; justify-content:flex-end; }
      .btn { font: inherit; background:#2563eb; color:#fff; border:0; border-radius:8px; padding:8px 16px; cursor:pointer; text-decoration:none; }
    </style></head><body>
    <div class="bar noprint">
      <button class="btn" onclick="window.print()">${esc(t(locale, 'print'))}</button>
    </div>
    ${body}
  </body></html>`;
}
