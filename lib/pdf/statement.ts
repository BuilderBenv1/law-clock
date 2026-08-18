import { Doc, ACCENT, BAND, CONTENT_W, INK, MARGIN, MUTED, PAGE_W, RULE } from './doc';
import type { ReportData } from '../queries';
import type { Settings } from '../db/schema';
import type { Locale } from '../i18n';
import { t } from '../i18n';
import { money, formatDate } from '../format';
import { formatGap, formatTimeOfDay } from '../time';

/**
 * The client-facing hours statement.
 *
 * Reads top-down the way a client reads a bill: what it costs, then which
 * matters it went on, then which tasks inside each matter, then — so the obvious
 * follow-up question never has to be asked — exactly when the work happened,
 * including the breaks between sittings.
 */
export async function renderStatementPdf(
  report: ReportData,
  s: Settings,
  locale: Locale,
): Promise<Uint8Array> {
  const rtl = locale === 'he';
  const doc = await Doc.create({
    rtl,
    footerNote: `${s.firmName}${s.taxId ? ` · ${t(locale, 'taxId')} ${s.taxId}` : ''}`,
  });

  await drawHeader(doc, report, s, locale);
  drawSummary(doc, report, s, locale);
  drawCaseBreakdown(doc, report, locale);
  drawTaskBreakdown(doc, report, locale);
  drawActivityLog(doc, report, s, locale);

  return doc.save();
}

async function drawHeader(doc: Doc, report: ReportData, s: Settings, locale: Locale): Promise<void> {
  const top = doc.y;

  // Firm identity on the reading-start side, with the logo above it when set.
  let identityY = top;
  if (s.logoUrl) {
    const h = await doc.drawLogo(s.logoUrl, {
      x: doc.startX,
      y: top,
      maxW: 150,
      maxH: 46,
      anchor: doc.rtl ? 'right' : 'left',
    });
    identityY = top - (h ? h + 10 : 0);
  }
  doc.draw(s.firmName, doc.startX, identityY - 6, {
    size: s.logoUrl ? 11 : 15,
    bold: true,
    anchor: doc.rtl ? 'right' : 'left',
    maxWidth: CONTENT_W * 0.55,
  });
  let y = identityY - 20;
  for (const detail of [s.firmAddress, s.firmPhone, s.firmEmail].filter(Boolean) as string[]) {
    doc.draw(detail, doc.startX, y, { size: 8, color: MUTED, anchor: doc.rtl ? 'right' : 'left', maxWidth: CONTENT_W * 0.55 });
    y -= 11;
  }

  // Document title and scope on the far side.
  const endAnchor = doc.rtl ? 'left' : 'right';
  doc.draw(t(locale, 'statement'), doc.endX, top - 8, { size: 19, bold: true, anchor: endAnchor, color: INK });
  const period = report.allTime
    ? t(locale, 'allTime')
    : `${formatDate(report.fromMs, s.timezone, locale)} – ${formatDate(report.toMs - 1, s.timezone, locale)}`;
  doc.draw(period, doc.endX, top - 26, { size: 9, color: MUTED, anchor: endAnchor });
  doc.draw(`${t(locale, 'generatedOn')} ${formatDate(Date.now(), s.timezone, locale)}`, doc.endX, top - 39, {
    size: 7.5,
    color: MUTED,
    anchor: endAnchor,
  });

  doc.y = Math.min(y, top - 52) - 6;
  doc.rule(ACCENT, 1.4);
  doc.y -= 16;

  // Bill-to block.
  doc.draw(t(locale, 'billTo').toUpperCase(), doc.startX, doc.y, {
    size: 7.5,
    color: MUTED,
    anchor: doc.rtl ? 'right' : 'left',
  });
  doc.y -= 14;
  doc.draw(report.client.name, doc.startX, doc.y, { size: 13, bold: true, anchor: doc.rtl ? 'right' : 'left' });
  const scope = report.project
    ? [report.project.caseNumber, report.project.name].filter(Boolean).join(' · ')
    : t(locale, 'allCases');
  doc.draw(`${t(locale, 'case')}: ${scope}`, doc.endX, doc.y, { size: 9, color: MUTED, anchor: doc.rtl ? 'left' : 'right' });
  doc.y -= 22;
}

function drawSummary(doc: Doc, report: ReportData, s: Settings, locale: Locale): void {
  const items = [
    { label: t(locale, 'hourlyRate'), value: money(report.rate, report.currency, locale) },
    { label: t(locale, 'actualHours'), value: report.totalHours.toFixed(2) },
    { label: t(locale, 'billedHours'), value: report.totalBilledHours.toFixed(2) },
    { label: t(locale, 'totalDue'), value: money(report.amount, report.currency, locale), accent: true },
  ];
  doc.stats(items);

  // The two hour figures differ by design; say so before the client asks.
  const note = `${t(locale, 'roundingNote')} (${t(locale, 'roundingUnit')}: ${report.roundIncrementMin} ${t(locale, 'minutes')})`;
  doc.draw(note, doc.startX, doc.y, {
    size: 7.5,
    color: MUTED,
    anchor: doc.rtl ? 'right' : 'left',
    maxWidth: CONTENT_W,
  });
  doc.y -= 12;

  if (report.totalNonBillableHours > 0) {
    doc.draw(
      `${t(locale, 'nonBillableHours')}: ${report.totalNonBillableHours.toFixed(2)}`,
      doc.startX,
      doc.y,
      { size: 7.5, color: MUTED, anchor: doc.rtl ? 'right' : 'left' },
    );
    doc.y -= 12;
  }
}

function drawCaseBreakdown(doc: Doc, report: ReportData, locale: Locale): void {
  if (report.cases.length === 0) {
    doc.section(t(locale, 'byCase'));
    doc.line(t(locale, 'noData'), { size: 9, color: MUTED });
    return;
  }

  doc.section(t(locale, 'byCase'));
  const cols = [
    { label: t(locale, 'case'), width: 3.4 },
    { label: t(locale, 'segments'), width: 1, num: true },
    { label: t(locale, 'actualHours'), width: 1.2, num: true },
    { label: t(locale, 'billedHours'), width: 1.2, num: true },
    { label: t(locale, 'amount'), width: 1.6, num: true },
  ];
  const spans = doc.tableHeader(cols);

  for (const c of report.cases) {
    const segments = c.tasks.reduce((n, task) => n + task.sessions.length, 0);
    doc.row(
      [
        [c.caseNumber, c.caseName].filter(Boolean).join(' · '),
        String(segments),
        c.hours.toFixed(2),
        c.billedHours.toFixed(2),
        money(c.amount, report.currency, locale),
      ],
      spans,
    );
  }

  const totalSegments = report.sessionCount;
  doc.row(
    [
      t(locale, 'total'),
      String(totalSegments),
      report.totalHours.toFixed(2),
      report.totalBilledHours.toFixed(2),
      money(report.amount, report.currency, locale),
    ],
    spans,
    { bold: true, rule: false },
  );
  doc.y -= 2;
}

function drawTaskBreakdown(doc: Doc, report: ReportData, locale: Locale): void {
  if (report.cases.length === 0) return;

  for (const c of report.cases) {
    doc.section(`${t(locale, 'case')}: ${[c.caseNumber, c.caseName].filter(Boolean).join(' · ')}`);
    const cols = [
      { label: t(locale, 'task'), width: 3.6 },
      { label: t(locale, 'segments'), width: 1, num: true },
      { label: t(locale, 'actualHours'), width: 1.2, num: true },
      { label: t(locale, 'billedHours'), width: 1.2, num: true },
      { label: t(locale, 'amount'), width: 1.6, num: true },
    ];
    const spans = doc.tableHeader(cols);
    for (const task of c.tasks) {
      const label = task.nonBillableHours > 0 ? `${task.taskName} (${t(locale, 'nonBillable')})` : task.taskName;
      doc.row(
        [
          label,
          String(task.sessions.length),
          task.hours.toFixed(2),
          task.billedHours.toFixed(2),
          money(task.amount, report.currency, locale),
        ],
        spans,
      );
    }
    doc.row(
      [
        t(locale, 'total'),
        String(c.tasks.reduce((n, task) => n + task.sessions.length, 0)),
        c.hours.toFixed(2),
        c.billedHours.toFixed(2),
        money(c.amount, report.currency, locale),
      ],
      spans,
      { bold: true, rule: false },
    );
    doc.y -= 2;
  }
}

/**
 * Chronological log of every sitting, with the break before it spelled out.
 * This is the part that answers "what were you doing on the 14th?" without a
 * phone call.
 */
function drawActivityLog(doc: Doc, report: ReportData, s: Settings, locale: Locale): void {
  if (report.cases.length === 0) return;
  doc.section(t(locale, 'activityLog'));

  const cols = [
    { label: t(locale, 'date'), width: 1.3 },
    { label: t(locale, 'startEnd'), width: 1.5 },
    { label: t(locale, 'task'), width: 3.4 },
    { label: t(locale, 'duration'), width: 1.1, num: true },
    { label: t(locale, 'billedHours'), width: 1.1, num: true },
  ];
  let spans = doc.tableHeader(cols);

  for (const c of report.cases) {
    for (const task of c.tasks) {
      for (const session of task.sessions) {
        // A break long enough to matter gets its own muted line, so the client
        // can see the work was not one unbroken stretch.
        if (session.gapMsBefore != null && session.gapMsBefore >= 60_000) {
          doc.ensure(16);
          doc.page.drawRectangle({
            x: MARGIN,
            y: doc.y - 4,
            width: CONTENT_W,
            height: 13,
            color: BAND,
          });
          doc.draw(
            `${t(locale, 'pauseGap')} — ${formatGap(session.gapMsBefore)}`,
            doc.rtl ? PAGE_W - MARGIN - 6 : MARGIN + 6,
            doc.y,
            { size: 7.5, color: MUTED, anchor: doc.rtl ? 'right' : 'left' },
          );
          doc.y -= 17;
        }

        const times =
          session.endMs != null
            ? `${formatTimeOfDay(session.startMs, s.timezone)}–${formatTimeOfDay(session.endMs, s.timezone)}`
            : formatTimeOfDay(session.startMs, s.timezone);

        const before = doc.y;
        doc.row(
          [
            formatDate(session.startMs, s.timezone, locale),
            times,
            session.description || task.taskName,
            session.hours.toFixed(2),
            session.billable ? session.billedHours.toFixed(2) : '—',
          ],
          spans,
          { size: 8.5, color: session.billable ? INK : MUTED },
        );
        // A page break inside the loop re-lays the header, so recompute spans.
        if (doc.y > before) spans = doc.tableHeader(cols);
      }
    }
  }

  doc.y -= 4;
  doc.draw(
    `${t(locale, 'total')}: ${report.totalHours.toFixed(2)} · ${t(locale, 'billedHours')} ${report.totalBilledHours.toFixed(2)}`,
    doc.startX,
    doc.y,
    { size: 9, bold: true, anchor: doc.rtl ? 'right' : 'left' },
  );
}
