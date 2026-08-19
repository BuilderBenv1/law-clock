import { and, desc, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { clients, invoices } from '@/lib/db/schema';
import { buildReport } from '@/lib/queries';
import { getSettings, localeOf } from '@/lib/settings';
import { renderStatementHtml } from '@/lib/statement-doc';
import { t } from '@/lib/i18n';
import { money, formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * The client's read-only portal. No login: the URL carries an unguessable
 * 40-char token minted per client, and revoking the token kills the link.
 * Scope is strictly that one client's data — the statement plus their invoices
 * — so the firm can share it without exposing anything else.
 */
export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 20) notFound();

  const db = getDb();
  const [client] = await db.select().from(clients).where(eq(clients.portalToken, token));
  if (!client || client.archived === 1) notFound();

  const s = await getSettings();
  const locale = localeOf(s);
  const report = await buildReport({ clientId: client.id, fromMs: 0, toMs: Date.now() + 1, allTime: true });
  if (!report) notFound();

  const invs = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.clientId, client.id)))
    .orderBy(desc(invoices.issuedAt))
    .limit(50);
  const unpaid = invs.filter((i) => i.status !== 'paid');
  const dueOf = (i: (typeof invs)[number]) => (i.total > 0 ? i.total : i.subtotal);
  const owed = unpaid.reduce((a, i) => a + dueOf(i), 0);

  const statement = renderStatementHtml(report, s, locale);

  return (
    // Light island inside the (dark) root shell: clients get a document look.
    <div style={{ minHeight: '100vh', background: '#eef1f6', color: '#16202f', fontFamily: "'Segoe UI', Arial, sans-serif" }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px' }}>
          <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{s.firmName}</div>
              <div style={{ fontSize: 13, color: '#68748a' }}>
                {t(locale, 'portalTitle')} — {client.name}
              </div>
            </div>
            {unpaid.length > 0 ? (
              <div style={{ background: '#fff3e6', border: '1px solid #f3ddc0', borderRadius: 10, padding: '10px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#b5741a' }}>
                  {t(locale, 'outstanding')}
                </div>
                <div style={{ fontSize: 20, fontWeight: 800 }}>{money(owed, client.currency, locale)}</div>
              </div>
            ) : null}
          </header>

          {invs.length > 0 ? (
            <section style={{ background: '#fff', borderRadius: 10, padding: '18px 22px', marginBottom: 18 }}>
              <h3 style={{ margin: '0 0 10px', fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#1e3a63' }}>
                {t(locale, 'invoices')}
              </h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <tbody>
                  {invs.map((inv) => (
                    <tr key={inv.id} style={{ borderBottom: '1px solid #eef1f6' }}>
                      <td style={{ padding: '7px 4px', fontWeight: 600 }}>{inv.number}</td>
                      <td style={{ padding: '7px 4px', color: '#68748a' }}>{formatDate(inv.issuedAt, s.timezone, locale)}</td>
                      <td style={{ padding: '7px 4px', color: '#68748a' }}>
                        {[inv.caseNumber, inv.caseName].filter(Boolean).join(' · ')}
                      </td>
                      <td style={{ padding: '7px 4px', textAlign: locale === 'he' ? 'left' : 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {money(dueOf(inv), inv.currency, locale)}
                      </td>
                      <td style={{ padding: '7px 4px', textAlign: locale === 'he' ? 'left' : 'right' }}>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            padding: '2px 9px',
                            borderRadius: 99,
                            background: inv.status === 'paid' ? '#e7f7ee' : '#fff3e6',
                            color: inv.status === 'paid' ? '#188a4b' : '#b5741a',
                          }}
                        >
                          {t(locale, inv.status === 'paid' ? 'paid' : 'unpaid')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          <div dangerouslySetInnerHTML={{ __html: statement }} />

          <footer style={{ textAlign: 'center', fontSize: 11, color: '#8b97ab', padding: '18px 0' }}>
            {s.firmName} · {[s.firmPhone, s.firmEmail].filter(Boolean).join(' · ')}
          </footer>
      </div>
    </div>
  );
}
