import Link from 'next/link';
import { getSettings, localeOf } from '@/lib/settings';
import { t } from '@/lib/i18n';
import { listInvoices } from '@/lib/invoice-service';
import { money, formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function InvoicesPage() {
  const s = await getSettings();
  const locale = localeOf(s);
  const invoices = await listInvoices();
  const now = Date.now();

  const dueOf = (inv: (typeof invoices)[number]) => (inv.total > 0 ? inv.total : inv.subtotal);
  const daysOpen = (inv: (typeof invoices)[number]) =>
    Math.floor((now - new Date(inv.issuedAt).getTime()) / 86_400_000);

  // The cash-flow picture: what's unpaid, how much, and how stale.
  const unpaid = invoices.filter((i) => i.status !== 'paid');
  const unpaidByCurrency = new Map<string, number>();
  for (const i of unpaid) unpaidByCurrency.set(i.currency, (unpaidByCurrency.get(i.currency) ?? 0) + dueOf(i));
  const oldestDays = unpaid.length > 0 ? Math.max(...unpaid.map(daysOpen)) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t(locale, 'invoices')}</h1>
        <Link href="/invoices/new" className="btn-primary">
          ＋ {t(locale, 'newInvoice')}
        </Link>
      </div>

      {unpaid.length > 0 && (
        <div className="card border-amber-800/50 bg-amber-950/10 flex items-center gap-6 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-wide text-amber-400">{t(locale, 'outstanding')}</div>
            <div className="num text-2xl font-bold mt-0.5">
              {[...unpaidByCurrency.entries()].map(([cur, sum]) => money(sum, cur, locale)).join(' + ')}
            </div>
          </div>
          <div className="text-sm text-slate-400">
            {unpaid.length} {t(locale, 'invoices')} · {locale === 'he' ? 'הוותיקה ביותר' : 'oldest'} {oldestDays}{' '}
            {t(locale, 'daysOpen')}
          </div>
        </div>
      )}

      {invoices.length === 0 ? (
        <p className="text-slate-500">{t(locale, 'noInvoices')}</p>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/50 text-slate-400 text-xs">
              <tr>
                <th className="text-start p-3">{t(locale, 'invoiceNo')}</th>
                <th className="text-start p-3">{t(locale, 'client')}</th>
                <th className="text-start p-3">{t(locale, 'issued')}</th>
                <th className="text-end p-3">{t(locale, 'amount')}</th>
                <th className="text-end p-3">{t(locale, 'status')}</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-t border-slate-800 hover:bg-slate-800/30">
                  <td className="p-3">
                    <Link href={`/invoices/${inv.id}`} className="hover:text-sky-300 font-medium">
                      {inv.number}
                    </Link>
                    {inv.caseNumber ? <div className="text-xs text-slate-500">{inv.caseNumber}</div> : null}
                  </td>
                  <td className="p-3">{inv.clientName}</td>
                  <td className="p-3 text-slate-400">{formatDate(inv.issuedAt, s.timezone, locale)}</td>
                  <td className="p-3 text-end num">{money(inv.total > 0 ? inv.total : inv.subtotal, inv.currency, locale)}</td>
                  <td className="p-3 text-end">
                    <span className={`pill ${inv.status === 'paid' ? 'bg-emerald-950 text-emerald-300' : 'bg-amber-950 text-amber-300'}`}>
                      {t(locale, inv.status === 'paid' ? 'paid' : 'unpaid')}
                    </span>
                    {inv.status !== 'paid' ? (
                      <div className={`text-xs mt-1 ${daysOpen(inv) > 30 ? 'text-red-400' : 'text-slate-500'}`}>
                        {daysOpen(inv)} {t(locale, 'daysOpen')}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
