import type { ReportData } from './queries';
import type { Settings } from './db/schema';
import type { Locale } from './i18n';
import { t } from './i18n';
import { formatDate, formatTime, formatGap, money } from './format';

function esc(x: string | null | undefined): string {
  return String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

/**
 * The client-facing hours statement. Deliberately verbose: it opens with the
 * headline numbers, then justifies them case by case, task by task, and finally
 * sitting by sitting with the breaks shown — so a client can answer their own
 * "what was I charged for?" without emailing the firm.
 */
export function renderStatementHtml(
  report: ReportData,
  s: Settings,
  locale: Locale,
  opts: { standalone?: boolean; detail?: boolean } = {},
): string {
  const rtl = locale === 'he';
  const dirAttr = rtl ? 'rtl' : 'ltr';
  const start = rtl ? 'right' : 'left';
  const end = rtl ? 'left' : 'right';
  const showDetail = opts.detail !== false;

  const period = report.allTime
    ? t(locale, 'allTime')
    : `${formatDate(report.fromMs, s.timezone, locale)} – ${formatDate(report.toMs - 1, s.timezone, locale)}`;

  const scope = report.project
    ? [report.project.caseNumber, report.project.name].filter(Boolean).join(' · ')
    : t(locale, 'allCases');

  const firmLine = [s.firmAddress, s.firmPhone, s.firmEmail, s.taxId ? `${t(locale, 'taxId')}: ${s.taxId}` : '']
    .filter(Boolean)
    .map(esc)
    .join(' · ');

  const logo = s.logoUrl
    ? `<img class="logo" src="${esc(s.logoUrl)}" alt="" />`
    : `<div class="firm-name">${esc(s.firmName)}</div>`;

  // ---- Summary tiles: the three numbers a client actually looks for.
  const summary = `
    <section class="summary">
      <div class="tile">
        <span>${esc(t(locale, 'feeRate'))}</span>
        <strong>${esc(money(report.rate, report.currency, locale))}</strong>
        <em>${esc(t(locale, 'perHour'))}</em>
      </div>
      <div class="tile">
        <span>${esc(t(locale, 'worked'))}</span>
        <strong>${report.totalHours.toFixed(2)}</strong>
        <em>${esc(t(locale, 'hours'))}</em>
      </div>
      <div class="tile">
        <span>${esc(t(locale, 'charged'))}</span>
        <strong>${report.totalBillable.toFixed(2)}</strong>
        <em>${esc(t(locale, 'hours'))}</em>
      </div>
      <div class="tile accent">
        <span>${esc(t(locale, 'total'))}</span>
        <strong>${esc(money(report.amount, report.currency, locale))}</strong>
        <em>&nbsp;</em>
      </div>
    </section>`;

  // ---- Per-case rollup.
  const caseRows = report.byCase
    .map(
      (c) => `<tr>
        <td>${c.caseNumber ? `<span class="muted">${esc(c.caseNumber)}</span> ` : ''}${esc(c.label)}</td>
        <td class="num">${esc(money(c.rate, report.currency, locale))}</td>
        <td class="num">${c.hours.toFixed(2)}</td>
        <td class="num">${c.billable.toFixed(2)}</td>
        <td class="num strong">${esc(money(c.amount, report.currency, locale))}</td>
      </tr>`,
    )
    .join('');

  const caseSection =
    report.byCase.length === 0
      ? ''
      : `
    <section class="block">
      <h3>${esc(t(locale, 'breakdownByCase'))}</h3>
      <table>
        <thead><tr>
          <th style="text-align:${start}">${esc(t(locale, 'case'))}</th>
          <th class="num">${esc(t(locale, 'feeRate'))}</th>
          <th class="num">${esc(t(locale, 'worked'))}</th>
          <th class="num">${esc(t(locale, 'charged'))}</th>
          <th class="num">${esc(t(locale, 'amount'))}</th>
        </tr></thead>
        <tbody>${caseRows}</tbody>
        <tfoot><tr>
          <td class="strong">${esc(t(locale, 'total'))}</td>
          <td></td>
          <td class="num strong">${report.totalHours.toFixed(2)}</td>
          <td class="num strong">${report.totalBillable.toFixed(2)}</td>
          <td class="num strong">${esc(money(report.amount, report.currency, locale))}</td>
        </tr></tfoot>
      </table>
    </section>`;

  // ---- Task breakdown, grouped under each case.
  const taskSections = report.byCase
    .map((c) => {
      const rows = c.byTask
        .map(
          (b) => `<tr>
            <td>${esc(b.label)}</td>
            <td class="num">${b.hours.toFixed(2)}</td>
            <td class="num">${b.billable.toFixed(2)}</td>
            <td class="num">${esc(money(b.amount, report.currency, locale))}</td>
          </tr>`,
        )
        .join('');
      const heading = [c.caseNumber, c.label].filter(Boolean).map(esc).join(' · ');
      return `
      <div class="case-block">
        <h4>${heading}</h4>
        <table>
          <thead><tr>
            <th style="text-align:${start}">${esc(t(locale, 'task'))}</th>
            <th class="num">${esc(t(locale, 'worked'))}</th>
            <th class="num">${esc(t(locale, 'charged'))}</th>
            <th class="num">${esc(t(locale, 'amount'))}</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    })
    .join('');

  const taskSection =
    report.byCase.length === 0
      ? ''
      : `<section class="block"><h3>${esc(t(locale, 'byTask'))}</h3>${taskSections}</section>`;

  // ---- Sitting-level detail, including the breaks between sittings.
  const detailRows = report.entries
    .map((e) => {
      const segs = e.segments;
      let sittingText = '';
      if (segs.length > 0) {
        const parts: string[] = [];
        for (let i = 0; i < segs.length; i++) {
          const sg = segs[i]!;
          const from = formatTime(sg.startMs, s.timezone, locale);
          const to = sg.endMs != null ? formatTime(sg.endMs, s.timezone, locale) : '…';
          parts.push(`${from}–${to}`);
          const next = segs[i + 1];
          if (next && sg.endMs != null) {
            const gap = next.startMs - sg.endMs;
            if (gap > 60_000) parts.push(`<span class="gap">⏸ ${esc(formatGap(gap))}</span>`);
          }
        }
        sittingText = parts.join(' <span class="sep">·</span> ');
      }
      return `<tr${e.isBillable ? '' : ' class="unbilled-row"'}>
        <td class="nowrap">${esc(formatDate(e.startMs, s.timezone, locale))}</td>
        <td>${esc(e.projectName)}</td>
        <td>${esc(e.taskName ?? e.description ?? '—')}${
          sittingText ? `<div class="sittings">${sittingText}</div>` : ''
        }${e.isBillable ? '' : `<div class="tag">${esc(t(locale, 'unbilled'))}</div>`}</td>
        <td class="num">${e.hours.toFixed(2)}</td>
        <td class="num">${e.isBillable ? e.billable.toFixed(2) : '—'}</td>
      </tr>`;
    })
    .join('');

  const detailSection =
    !showDetail || report.entries.length === 0
      ? ''
      : `
    <section class="block">
      <h3>${esc(t(locale, 'sessionDetail'))}</h3>
      <p class="note">${esc(
        locale === 'he'
          ? 'שעות העבודה מוצגות לפי מקטעים; סימון ⏸ מציין הפסקה שאינה נכללת בחיוב.'
          : 'Work is shown by sitting; ⏸ marks a break, which is not charged.',
      )}</p>
      <table>
        <thead><tr>
          <th style="text-align:${start}">${esc(t(locale, 'date'))}</th>
          <th style="text-align:${start}">${esc(t(locale, 'case'))}</th>
          <th style="text-align:${start}">${esc(t(locale, 'description'))}</th>
          <th class="num">${esc(t(locale, 'worked'))}</th>
          <th class="num">${esc(t(locale, 'charged'))}</th>
        </tr></thead>
        <tbody>${detailRows}</tbody>
      </table>
    </section>`;

  const roundingNote =
    report.totalBillable !== report.totalHours
      ? `<p class="note">${esc(
          locale === 'he'
            ? `שעות לחיוב מעוגלות כלפי מעלה למקטעים של ${s.roundIncrementMin} דקות, ולכן ייתכן פער מול השעות בפועל.`
            : `Charged hours are rounded up to ${s.roundIncrementMin}-minute increments, so they can differ from hours worked.`,
        )}</p>`
      : '';

  const unbilledNote =
    report.unbilledHours > 0
      ? `<p class="note credit">${esc(
          locale === 'he'
            ? `כולל ${report.unbilledHours.toFixed(2)} שעות שנרשמו ולא חויבו.`
            : `Includes ${report.unbilledHours.toFixed(2)} hours logged at no charge.`,
        )}</p>`
      : '';

  const body = `
  <div class="doc" id="statement-doc" dir="${dirAttr}" style="text-align:${start}">
    <header class="head">
      <div class="brand">
        ${logo}
        <div class="muted small">${firmLine}</div>
      </div>
      <div class="meta" style="text-align:${end}">
        <div class="title">${esc(t(locale, 'statement'))}</div>
        <div class="muted small">${esc(t(locale, 'generatedOn'))} ${esc(formatDate(Date.now(), s.timezone, locale))}</div>
      </div>
    </header>

    <section class="parties">
      <div>
        <div class="label">${esc(t(locale, 'billTo'))}</div>
        <div class="strong big">${esc(report.client.name)}</div>
        <div class="muted small">${[report.client.email, report.client.phone, report.client.address].filter(Boolean).map(esc).join(' · ')}</div>
      </div>
      <div style="text-align:${end}">
        <div class="label">${esc(t(locale, 'month'))}</div>
        <div class="strong">${esc(period)}</div>
        <div class="muted small">${esc(scope)}</div>
      </div>
    </section>

    ${summary}
    ${roundingNote}${unbilledNote}
    ${caseSection}
    ${taskSection}
    ${detailSection}

    <footer class="foot">
      <div>${esc(s.firmName)}</div>
      <div class="muted small">${firmLine}</div>
    </footer>
  </div>`;

  // Page-level rules live apart from the document's own rules: this markup is
  // also embedded inside the dark app shell, where a stray `body` rule would
  // repaint the whole screen. Only the standalone page emits these.
  const pageCss = `
    :root { color-scheme: light; }
    body { margin:0; background:#eef1f6; }
    @media print { body { background:#fff; } }
  `;

  const css = `
    .doc, .doc * { box-sizing: border-box; }
    .doc { max-width: 860px; margin: 24px auto; background:#fff; padding: 40px 44px; border-radius: 10px;
           font-family: 'Segoe UI', Arial, 'Helvetica Neue', sans-serif; color:#16202f; }
    .head { display:flex; justify-content:space-between; align-items:flex-start; gap:20px;
            border-bottom:3px double #c8d2e4; padding-bottom:18px; }
    .logo { max-height:62px; max-width:220px; object-fit:contain; }
    .firm-name { font-size:21px; font-weight:700; letter-spacing:0.01em; }
    .title { font-size:24px; font-weight:800; letter-spacing:0.08em; text-transform:uppercase; color:#1e3a63; }
    .muted { color:#68748a; }
    .small { font-size:12px; line-height:1.55; margin-top:4px; }
    .label { font-size:10.5px; text-transform:uppercase; letter-spacing:0.09em; color:#8b97ab; margin-bottom:3px; }
    .strong { font-weight:700; }
    .big { font-size:17px; }
    .parties { display:flex; justify-content:space-between; gap:20px; margin:22px 0 26px; }

    .summary { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:20px; }
    .tile { flex:1 1 150px; background:#f6f8fc; border:1px solid #dde5f1; border-radius:9px; padding:14px 16px; }
    .tile span { display:block; font-size:10.5px; text-transform:uppercase; letter-spacing:0.08em; color:#8b97ab; }
    .tile strong { display:block; font-size:23px; margin-top:5px; font-variant-numeric:tabular-nums; }
    .tile em { font-style:normal; font-size:11px; color:#8b97ab; }
    .tile.accent { background:#1e3a63; border-color:#1e3a63; }
    .tile.accent span, .tile.accent em { color:#a8bde0; }
    .tile.accent strong { color:#fff; }

    .block { margin-top:26px; page-break-inside:auto; }
    h3 { font-size:12px; text-transform:uppercase; letter-spacing:0.09em; color:#1e3a63;
         border-bottom:1px solid #dde5f1; padding-bottom:6px; margin:0 0 10px; }
    h4 { font-size:13px; margin:16px 0 6px; color:#2b3b56; }
    .case-block { margin-bottom:14px; page-break-inside:avoid; }

    table { width:100%; border-collapse:collapse; font-size:12.5px; }
    th { color:#68748a; font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:0.05em;
         padding:7px 8px; border-bottom:1.5px solid #dde5f1; }
    td { padding:8px; border-bottom:1px solid #eef1f6; vertical-align:top; }
    tfoot td { border-top:1.5px solid #c8d2e4; border-bottom:none; padding-top:10px; }
    .num { text-align:${end}; font-variant-numeric:tabular-nums; white-space:nowrap; }
    .nowrap { white-space:nowrap; }
    tbody tr:nth-child(even) { background:#fafbfd; }

    .sittings { font-size:11px; color:#68748a; margin-top:3px; }
    .gap { color:#b5741a; }
    .sep { color:#c8d2e4; }
    .tag { display:inline-block; margin-top:4px; font-size:10px; padding:1px 7px; border-radius:99px;
           background:#eef1f6; color:#68748a; }
    .unbilled-row td { color:#8b97ab; }
    .note { font-size:11.5px; color:#68748a; margin:8px 0 0; }
    .note.credit { color:#1a7a4c; }

    .foot { margin-top:32px; padding-top:14px; border-top:1px solid #dde5f1; font-size:12px; }

    @media print {
      .doc { margin:0; max-width:none; border-radius:0; padding:0; }
      .noprint { display:none; }
      .doc thead { display:table-header-group; }
    }
  `;

  if (!opts.standalone) return `<style>${css}</style>${body}`;

  return `<!doctype html><html lang="${locale}" dir="${dirAttr}"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${esc(t(locale, 'statement'))} — ${esc(report.client.name)}</title>
    <style>${pageCss}${css}
      .bar { max-width:860px; margin:14px auto 0; display:flex; gap:8px; justify-content:flex-end; }
      .btn { font:inherit; background:#1e3a63; color:#fff; border:0; border-radius:8px; padding:9px 18px; cursor:pointer; }
      .btn.ghost { background:#dde5f1; color:#1e3a63; }
    </style></head><body>
    <div class="bar noprint"><button class="btn" onclick="window.print()">${esc(t(locale, 'printDoc'))}</button></div>
    ${body}
  </body></html>`;
}
