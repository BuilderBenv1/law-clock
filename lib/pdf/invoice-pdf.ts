import { Doc, ACCENT, CONTENT_W, GREEN, INK, MUTED } from './doc';
import type { InvoiceDetail } from '../invoice-service';
import type { Locale } from '../i18n';
import { t } from '../i18n';
import { money, formatDate } from '../format';

/** The invoice as a real, downloadable PDF — same identity snapshot as the on-screen copy. */
export async function renderInvoicePdfDoc(detail: InvoiceDetail, locale: Locale): Promise<Uint8Array> {
  const { invoice: inv, lines, settings: s } = detail;
  const rtl = locale === 'he';
  const paid = inv.status === 'paid';
  const doc = await Doc.create({
    rtl,
    footerNote: `${inv.firmName}${inv.taxId ? ` · ${t(locale, 'taxId')} ${inv.taxId}` : ''}`,
  });

  const startAnchor = rtl ? 'right' : 'left';
  const endAnchor = rtl ? 'left' : 'right';
  const top = doc.y;

  // Firm identity (with logo) on the reading-start side.
  let identityY = top;
  if (inv.logoUrl) {
    const h = await doc.drawLogo(inv.logoUrl, { x: doc.startX, y: top, maxW: 150, maxH: 46, anchor: startAnchor });
    identityY = top - (h ? h + 10 : 0);
  }
  doc.draw(inv.firmName, doc.startX, identityY - 6, {
    size: inv.logoUrl ? 11 : 15,
    bold: true,
    anchor: startAnchor,
    maxWidth: CONTENT_W * 0.55,
  });
  let y = identityY - 20;
  for (const detailLine of [inv.firmAddress, inv.firmPhone, inv.firmEmail].filter(Boolean) as string[]) {
    doc.draw(detailLine, doc.startX, y, { size: 8, color: MUTED, anchor: startAnchor, maxWidth: CONTENT_W * 0.55 });
    y -= 11;
  }

  // Document meta on the far side.
  doc.draw(t(locale, 'invoice'), doc.endX, top - 8, { size: 22, bold: true, anchor: endAnchor });
  doc.draw(`${t(locale, 'invoiceNo')} ${inv.number}`, doc.endX, top - 27, { size: 10, color: MUTED, anchor: endAnchor });
  doc.draw(`${t(locale, 'issued')}: ${formatDate(inv.issuedAt, s.timezone, locale)}`, doc.endX, top - 40, {
    size: 8,
    color: MUTED,
    anchor: endAnchor,
  });
  doc.draw(t(locale, paid ? 'paid' : 'unpaid'), doc.endX, top - 55, {
    size: 10,
    bold: true,
    anchor: endAnchor,
    color: paid ? GREEN : ACCENT,
  });

  doc.y = Math.min(y, top - 66) - 6;
  doc.rule(ACCENT, 1.4);
  doc.y -= 16;

  // Parties + case.
  doc.draw(t(locale, 'billTo').toUpperCase(), doc.startX, doc.y, { size: 7.5, color: MUTED, anchor: startAnchor });
  doc.y -= 14;
  doc.draw(inv.clientName, doc.startX, doc.y, { size: 12.5, bold: true, anchor: startAnchor });
  const caseLabel = [inv.caseNumber, inv.caseName].filter(Boolean).join(' · ');
  if (caseLabel) {
    doc.draw(`${t(locale, 'case')}: ${caseLabel}`, doc.endX, doc.y, { size: 9, color: MUTED, anchor: endAnchor });
  }
  doc.y -= 13;
  for (const line of [inv.clientEmail, inv.clientAddress].filter(Boolean) as string[]) {
    doc.draw(line, doc.startX, doc.y, { size: 8, color: MUTED, anchor: startAnchor });
    doc.y -= 11;
  }
  doc.y -= 12;

  // Line items.
  const cols = [
    { label: t(locale, 'description'), width: 4 },
    { label: t(locale, 'hours'), width: 1.1, num: true },
    { label: t(locale, 'hourlyRate'), width: 1.4, num: true },
    { label: t(locale, 'amount'), width: 1.5, num: true },
  ];
  const spans = doc.tableHeader(cols);
  for (const l of lines) {
    const flat = l.hours === 0 && l.ratePerHour === 0;
    doc.row(
      [
        l.label,
        flat ? '—' : l.hours.toFixed(2),
        flat ? '—' : money(l.ratePerHour, inv.currency, locale),
        money(l.amount, inv.currency, locale),
      ],
      spans,
    );
  }

  // Total.
  doc.y -= 6;
  doc.ensure(40);
  doc.rule(ACCENT, 1.2);
  doc.y -= 18;
  doc.draw(t(locale, 'totalDue'), doc.startX, doc.y, { size: 12, bold: true, anchor: startAnchor });
  doc.draw(money(inv.subtotal, inv.currency, locale), doc.endX, doc.y, {
    size: 16,
    bold: true,
    anchor: endAnchor,
    color: ACCENT,
  });
  doc.y -= 24;

  if (inv.notes) {
    doc.y -= 6;
    doc.draw(t(locale, 'notes').toUpperCase(), doc.startX, doc.y, { size: 7.5, color: MUTED, anchor: startAnchor });
    doc.y -= 13;
    doc.paragraph(inv.notes, { size: 9, color: INK });
  }

  if (paid && inv.paidAt) {
    doc.y -= 8;
    doc.draw(`${t(locale, 'paid')} · ${formatDate(inv.paidAt, s.timezone, locale)}`, doc.startX, doc.y, {
      size: 10,
      bold: true,
      color: GREEN,
      anchor: startAnchor,
    });
  }

  return doc.save();
}
