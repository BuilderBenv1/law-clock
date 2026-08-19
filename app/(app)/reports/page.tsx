import { ReportForm, type ReportFormClient } from '@/components/report-form';
import { PieChart } from '@/components/pie-chart';
import { DownloadPdfButton } from '@/components/download-pdf-button';
import { getSettings, localeOf } from '@/lib/settings';
import { t } from '@/lib/i18n';
import { buildReport, getClientsTree } from '@/lib/queries';
import { renderStatementHtml } from '@/lib/statement-doc';
import { money, formatDate } from '@/lib/format';
import { startOfMonthMs } from '@/lib/time';

export const dynamic = 'force-dynamic';

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const s = await getSettings();
  const locale = localeOf(s);
  const now = Date.now();

  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
  const clientId = one(sp.clientId);
  const projectId = one(sp.projectId) || null;
  const allTime = one(sp.allTime) === '1';
  const fromMs = Number(one(sp.from)) || startOfMonthMs(now, s.timezone);
  const toMs = Number(one(sp.to)) || now + 1;

  const tree = await getClientsTree();
  const clients: ReportFormClient[] = tree.map((c) => ({
    id: c.id,
    name: c.name,
    projects: c.projects.map((p) => ({ id: p.id, name: p.caseNumber ? `${p.caseNumber} · ${p.name}` : p.name })),
  }));

  const report = clientId ? await buildReport({ clientId, projectId, fromMs, toMs, allTime }) : null;

  const qs = () => {
    const q = new URLSearchParams({ clientId, from: String(fromMs), to: String(toMs) });
    if (projectId) q.set('projectId', projectId);
    if (allTime) q.set('allTime', '1');
    return q.toString();
  };
  const csvHref = report ? `/api/reports/csv?${qs()}` : '#';
  const printHref = report ? `/reports/print?${qs()}` : '#';

  const statementHtml = report ? renderStatementHtml(report, s, locale) : '';
  const fileName = report
    ? `statement-${report.client.name}-${report.allTime ? 'all-time' : new Date(fromMs).toISOString().slice(0, 10)}`
    : 'statement';

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t(locale, 'reports')}</h1>

      <ReportForm
        clients={clients}
        locale={locale}
        initial={{ clientId, projectId: projectId ?? '', fromMs, toMs, allTime }}
      />

      {report && (
        <div className="space-y-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-lg font-semibold">
                {report.client.name}
                <span className="text-slate-500"> · {report.project ? report.project.name : t(locale, 'allCases')}</span>
              </h2>
              <div className="text-xs text-slate-500">
                {report.allTime
                  ? t(locale, 'allTime')
                  : `${formatDate(report.fromMs, s.timezone, locale)} – ${formatDate(report.toMs - 1, s.timezone, locale)}`}
              </div>
            </div>
            <div className="flex gap-2 flex-wrap items-center">
              <a href={csvHref} className="btn-ghost">
                ⭳ {t(locale, 'exportCsv')}
              </a>
              <a href={printHref} target="_blank" className="btn-ghost">
                🖶 {t(locale, 'printDoc')}
              </a>
              <DownloadPdfButton targetId="statement-doc" filename={fileName} label={t(locale, 'downloadPdf')} />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label={t(locale, 'worked')} value={report.totalHours.toFixed(2)} />
            <Stat label={t(locale, 'charged')} value={report.totalBillable.toFixed(2)} />
            <Stat label={t(locale, 'unbilledHours')} value={report.unbilledHours.toFixed(2)} dim />
            <Stat label={t(locale, 'amount')} value={money(report.amount, report.currency, locale)} highlight />
          </div>

          {report.totalBillable !== report.totalHours && (
            <p className="text-xs text-slate-500">
              {locale === 'he'
                ? `שעות לחיוב מעוגלות כלפי מעלה למקטעים של ${s.roundIncrementMin} דקות — לכן הן שונות מסך השעות בפועל.`
                : `Charged hours are rounded up to ${s.roundIncrementMin}-minute increments, which is why they differ from hours worked.`}
            </p>
          )}

          {report.entries.length === 0 ? (
            <p className="text-slate-500">{t(locale, 'noData')}</p>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <PieChart
                  title={t(locale, 'breakdownByCase')}
                  unit={t(locale, 'hours')}
                  locale={locale}
                  slices={report.byCase.map((c) => ({ label: c.label, value: c.hours }))}
                />
                <PieChart
                  title={t(locale, 'byTask')}
                  unit={t(locale, 'hours')}
                  locale={locale}
                  slices={report.byTask.map((b) => ({ label: b.label, value: b.hours }))}
                />
              </div>

              {/* The client-facing document, exactly as it downloads and prints. */}
              <section>
                <h3 className="font-semibold mb-2">{t(locale, 'statement')}</h3>
                <div className="rounded-xl overflow-hidden border border-slate-800 bg-white text-black">
                  <div dangerouslySetInnerHTML={{ __html: statementHtml }} />
                </div>
              </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, highlight, dim }: { label: string; value: string; highlight?: boolean; dim?: boolean }) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`num text-2xl font-bold mt-1 ${highlight ? 'text-emerald-300' : dim ? 'text-slate-500' : ''}`}>
        {value}
      </div>
    </div>
  );
}
