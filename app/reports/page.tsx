import { ReportForm, type ReportFormClient } from '@/components/report-form';
import { PieChart } from '@/components/pie-chart';
import { getSettings, localeOf } from '@/lib/settings';
import { t } from '@/lib/i18n';
import { buildReport, getClientsTree, reportSessions } from '@/lib/queries';
import { money, formatDate } from '@/lib/format';
import { startOfMonthMs, formatGap, formatTimeOfDay } from '@/lib/time';

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
    projects: c.projects.map((p) => ({ id: p.id, name: p.name, caseNumber: p.caseNumber })),
  }));

  const report = clientId ? await buildReport({ clientId, projectId, fromMs, toMs, allTime }) : null;

  const qs = new URLSearchParams({ clientId });
  if (projectId) qs.set('projectId', projectId);
  if (allTime) qs.set('allTime', '1');
  else {
    qs.set('from', String(fromMs));
    qs.set('to', String(toMs));
  }
  const query = qs.toString();

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
                <span className="text-slate-500">
                  {' · '}
                  {report.project
                    ? [report.project.caseNumber, report.project.name].filter(Boolean).join(' · ')
                    : t(locale, 'allCases')}
                </span>
              </h2>
              <div className="text-xs text-slate-500">
                {report.allTime
                  ? t(locale, 'allTime')
                  : `${formatDate(report.fromMs, s.timezone, locale)} – ${formatDate(report.toMs - 1, s.timezone, locale)}`}
                {' · '}
                {report.sessionCount} {t(locale, 'workSegments')}
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <a href={`/api/reports/csv?${query}`} className="btn-ghost">
                ⭳ {t(locale, 'exportCsv')}
              </a>
              <a href={`/reports/print?${query}`} target="_blank" className="btn-ghost">
                🖶 {t(locale, 'print')}
              </a>
              <a href={`/api/reports/pdf?${query}`} className="btn-primary">
                ⭳ {t(locale, 'downloadStatement')}
              </a>
            </div>
          </div>

          {/* Headline figures. Actual and billed differ by design — say why, right here. */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label={t(locale, 'actualHours')} value={report.totalHours.toFixed(2)} />
            <Stat label={t(locale, 'billedHours')} value={report.totalBilledHours.toFixed(2)} />
            <Stat label={t(locale, 'nonBillableHours')} value={report.totalNonBillableHours.toFixed(2)} muted />
            <Stat label={t(locale, 'amount')} value={money(report.amount, report.currency, locale)} highlight />
          </div>
          <p className="text-xs text-slate-500 -mt-2">
            {t(locale, 'roundingNote')} ({t(locale, 'roundingUnit')}: {report.roundIncrementMin}{' '}
            {t(locale, 'minutes')})
          </p>

          {report.cases.length === 0 ? (
            <p className="text-slate-500">{t(locale, 'noData')}</p>
          ) : (
            <>
              {/* Where the time went */}
              <div className="grid gap-4 md:grid-cols-2">
                <PieChart
                  title={`${t(locale, 'timeSpent')} — ${t(locale, 'byCase')}`}
                  centerLabel={t(locale, 'hours')}
                  otherLabel={locale === 'he' ? 'אחר' : 'Other'}
                  slices={report.cases.map((c) => ({
                    label: [c.caseNumber, c.caseName].filter(Boolean).join(' · '),
                    value: c.hours,
                  }))}
                  formatValue={(n) => n.toFixed(2)}
                />
                <PieChart
                  title={`${t(locale, 'timeSpent')} — ${t(locale, 'byTask')}`}
                  centerLabel={t(locale, 'hours')}
                  otherLabel={locale === 'he' ? 'אחר' : 'Other'}
                  slices={report.byTask.map((b) => ({ label: b.label, value: b.hours }))}
                  formatValue={(n) => n.toFixed(2)}
                />
              </div>

              {/* Cases */}
              <section>
                <h3 className="font-semibold mb-2">{t(locale, 'byCase')}</h3>
                <Table
                  head={[
                    t(locale, 'case'),
                    t(locale, 'segments'),
                    t(locale, 'actualHours'),
                    t(locale, 'billedHours'),
                    t(locale, 'amount'),
                  ]}
                  rows={report.cases.map((c) => [
                    [c.caseNumber, c.caseName].filter(Boolean).join(' · '),
                    String(c.tasks.reduce((n, task) => n + task.sessions.length, 0)),
                    c.hours.toFixed(2),
                    c.billedHours.toFixed(2),
                    money(c.amount, report.currency, locale),
                  ])}
                  numCols={[1, 2, 3, 4]}
                />
              </section>

              {/* Tasks within each case */}
              {report.cases.map((c) => (
                <section key={c.projectId}>
                  <h3 className="font-semibold mb-2">
                    {t(locale, 'case')}: {[c.caseNumber, c.caseName].filter(Boolean).join(' · ')}
                  </h3>
                  <Table
                    head={[
                      t(locale, 'task'),
                      t(locale, 'segments'),
                      t(locale, 'actualHours'),
                      t(locale, 'billedHours'),
                      t(locale, 'amount'),
                    ]}
                    rows={c.tasks.map((task) => [
                      task.nonBillableHours > 0 ? `${task.taskName} · ${t(locale, 'nonBillable')}` : task.taskName,
                      String(task.sessions.length),
                      task.hours.toFixed(2),
                      task.billedHours.toFixed(2),
                      money(task.amount, report.currency, locale),
                    ])}
                    numCols={[1, 2, 3, 4]}
                  />
                </section>
              ))}

              {/* Chronological log, with the breaks made explicit */}
              <section>
                <h3 className="font-semibold mb-2">{t(locale, 'activityLog')}</h3>
                <div className="card p-0 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-900/50 text-slate-400 text-xs">
                      <tr>
                        <th className="text-start p-3">{t(locale, 'date')}</th>
                        <th className="text-start p-3">{t(locale, 'startEnd')}</th>
                        <th className="text-start p-3">{t(locale, 'task')}</th>
                        <th className="text-end p-3">{t(locale, 'duration')}</th>
                        <th className="text-end p-3">{t(locale, 'billedHours')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportSessions(report).map((row) => {
                        const se = row.session;
                        const showGap = se.gapMsBefore != null && se.gapMsBefore >= 60_000;
                        return (
                          <tr key={se.id} className="border-t border-slate-800">
                            <td className="p-3 whitespace-nowrap">{formatDate(se.startMs, s.timezone, locale)}</td>
                            <td className="p-3 whitespace-nowrap num">
                              {formatTimeOfDay(se.startMs, s.timezone)}
                              {se.endMs != null ? `–${formatTimeOfDay(se.endMs, s.timezone)}` : ''}
                              {showGap && (
                                <span className="ms-2 text-[11px] text-slate-500">
                                  ⏸ {formatGap(se.gapMsBefore!)}
                                </span>
                              )}
                            </td>
                            <td className={`p-3 ${se.billable ? 'text-slate-300' : 'text-slate-500'}`}>
                              {se.description || row.taskName}
                            </td>
                            <td className="p-3 text-end num">{se.hours.toFixed(2)}</td>
                            <td className="p-3 text-end num">{se.billable ? se.billedHours.toFixed(2) : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
  muted,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div
        className={`num text-2xl font-bold mt-1 ${highlight ? 'text-emerald-300' : muted ? 'text-slate-500' : ''}`}
      >
        {value}
      </div>
    </div>
  );
}

function Table({ head, rows, numCols }: { head: string[]; rows: string[][]; numCols: number[] }) {
  const numSet = new Set(numCols);
  return (
    <div className="card p-0 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-900/50 text-slate-400 text-xs">
          <tr>
            {head.map((h, i) => (
              <th key={i} className={`p-3 ${numSet.has(i) ? 'text-end' : 'text-start'}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-t border-slate-800">
              {r.map((c, ci) => (
                <td key={ci} className={`p-3 ${numSet.has(ci) ? 'text-end num' : 'text-start'}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
