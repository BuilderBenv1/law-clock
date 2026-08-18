import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProjectDetail } from '@/lib/queries';
import { getSettings, localeOf } from '@/lib/settings';
import { t } from '@/lib/i18n';
import { money, formatDate } from '@/lib/format';
import { formatHm, formatTimeOfDay } from '@/lib/time';
import { Combobox } from '@/components/combobox';
import {
  archiveTask,
  addManualEntry,
  deleteEntry,
  toggleEntryBillable,
  updateProject,
  setProjectStatus,
  archiveProject,
  resumeTask,
} from '@/lib/actions';

export const dynamic = 'force-dynamic';

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSettings();
  const locale = localeOf(s);
  const d = await getProjectDetail(id);
  if (!d) notFound();
  const { project, client, tasks, entries, hours, billedHours, nonBillableHours, rate, currency, amount } = d;

  const hoursCap = project.alertThresholdHours;
  const amountCap = project.alertThresholdAmount;
  const overHours = hoursCap != null && hoursCap > 0 && hours >= hoursCap;
  const overAmount = amountCap != null && amountCap > 0 && amount >= amountCap;

  const query = `clientId=${client.id}&projectId=${project.id}&allTime=1`;
  const isoToday = new Date().toISOString().slice(0, 10);
  const taskNames = tasks.map((tk) => tk.name);

  return (
    <div className="space-y-8">
      <header>
        <Link href={`/clients/${client.id}`} className="text-xs text-slate-500 hover:underline">
          ← {client.name}
        </Link>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-semibold">
            {project.caseNumber ? <span className="text-slate-500">{project.caseNumber} · </span> : null}
            {project.name}
          </h1>
          <span
            className={`pill ${project.status === 'open' ? 'bg-sky-950 text-sky-300' : 'bg-slate-800 text-slate-400'}`}
          >
            {t(locale, project.status === 'open' ? 'open' : 'closed')}
          </span>
          {project.isDefault === 1 && (
            <span className="pill bg-slate-800 text-slate-400">{t(locale, 'generalCase')}</span>
          )}
        </div>
        {project.description ? <p className="text-sm text-slate-400 mt-1">{project.description}</p> : null}
      </header>

      {/* Totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label={t(locale, 'actualHours')} value={hours.toFixed(2)} />
        <Stat label={t(locale, 'billedHours')} value={billedHours.toFixed(2)} />
        <Stat label={t(locale, 'hourlyRate')} value={money(rate, currency, locale)} />
        <Stat label={t(locale, 'amount')} value={money(amount, currency, locale)} highlight />
      </div>
      <p className="text-xs text-slate-500 -mt-4">
        {t(locale, 'roundingNote')} ({t(locale, 'roundingUnit')}: {s.roundIncrementMin} {t(locale, 'minutes')})
        {nonBillableHours > 0 && ` · ${t(locale, 'nonBillableHours')}: ${nonBillableHours.toFixed(2)}`}
      </p>

      {/* Alert progress */}
      {(hoursCap || amountCap) && (
        <div className={`card space-y-3 ${overHours || overAmount ? 'border-amber-700/60 bg-amber-950/20' : ''}`}>
          {hoursCap != null && hoursCap > 0 && (
            <Progress
              label={t(locale, 'alertThreshold')}
              current={`${hours.toFixed(2)} / ${hoursCap.toFixed(1)}`}
              pct={Math.min(100, (hours / hoursCap) * 100)}
              over={overHours}
              note={overHours ? t(locale, 'reached') : null}
            />
          )}
          {amountCap != null && amountCap > 0 && (
            <Progress
              label={t(locale, 'alertAmount')}
              current={`${money(amount, currency, locale)} / ${money(amountCap, currency, locale)}`}
              pct={Math.min(100, (amount / amountCap) * 100)}
              over={overAmount}
              note={overAmount ? t(locale, 'reached') : null}
            />
          )}
        </div>
      )}

      {/* Documents */}
      <section className="card">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="font-semibold">{t(locale, 'statement')}</h2>
            <div className="text-xs text-slate-500">{t(locale, 'allTime')}</div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <a href={`/api/reports/csv?${query}`} className="btn-ghost">
              ⭳ {t(locale, 'exportCsv')}
            </a>
            <a href={`/api/reports/pdf?${query}`} className="btn-ghost">
              ⭳ {t(locale, 'downloadStatement')}
            </a>
            <Link href={`/invoices/new?clientId=${client.id}&projectId=${project.id}`} className="btn-green">
              ＋ {t(locale, 'newInvoice')}
            </Link>
            <Link href={`/reports?${query}`} className="btn-primary">
              {t(locale, 'reportFor')} →
            </Link>
          </div>
        </div>
      </section>

      {/* Tasks — each resumable in one click */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t(locale, 'tasks')}</h2>
        {tasks.length === 0 ? (
          <p className="text-sm text-slate-500">{t(locale, 'noEntries')}</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {tasks.map((tk) => (
              <li
                key={tk.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 px-3 py-2"
              >
                <span className="truncate text-sm">{tk.name}</span>
                <span className="flex items-center gap-1 shrink-0">
                  <form action={resumeTask}>
                    <input type="hidden" name="clientId" value={client.id} />
                    <input type="hidden" name="projectId" value={project.id} />
                    <input type="hidden" name="taskId" value={tk.id} />
                    <input type="hidden" name="taskName" value={tk.name} />
                    <button className="btn-green px-3 py-1 text-xs" type="submit">
                      ▶ {t(locale, 'resume')}
                    </button>
                  </form>
                  <form action={archiveTask}>
                    <input type="hidden" name="id" value={tk.id} />
                    <input type="hidden" name="projectId" value={project.id} />
                    <button type="submit" className="text-slate-600 hover:text-red-400 px-1" title={t(locale, 'delete')}>
                      ✕
                    </button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Manual entry */}
      <details className="card">
        <summary className="cursor-pointer font-medium">＋ {t(locale, 'manualEntry')}</summary>
        <form action={addManualEntry} className="grid gap-3 md:grid-cols-4 mt-4">
          <input type="hidden" name="clientId" value={client.id} />
          <input type="hidden" name="projectId" value={project.id} />
          <div className="md:col-span-2">
            <label className="label">{t(locale, 'taskLabel')}</label>
            <Combobox name="taskName" options={taskNames} placeholder={t(locale, 'taskPickerHint')} />
          </div>
          <div>
            <label className="label">{t(locale, 'manualHours')}</label>
            <input name="hours" type="number" step="0.1" min="0" className="input" required />
          </div>
          <div>
            <label className="label">{t(locale, 'manualDate')}</label>
            <input name="date" type="date" className="input" defaultValue={isoToday} />
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-400 md:col-span-2">
            <input type="checkbox" name="nonBillable" value="1" className="w-4 h-4" />
            {t(locale, 'markNonBillable')}
          </label>
          <div className="md:col-span-2 flex justify-end">
            <button className="btn-primary" type="submit">
              {t(locale, 'add')}
            </button>
          </div>
        </form>
      </details>

      {/* Sessions */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t(locale, 'workSegments')}</h2>
        {entries.length === 0 ? (
          <p className="text-sm text-slate-500">{t(locale, 'noEntries')}</p>
        ) : (
          <div className="card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-900/50 text-slate-400 text-xs">
                <tr>
                  <th className="text-start p-3">{t(locale, 'date')}</th>
                  <th className="text-start p-3">{t(locale, 'startEnd')}</th>
                  <th className="text-start p-3">{t(locale, 'task')}</th>
                  <th className="text-end p-3">{t(locale, 'duration')}</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((r) => (
                  <tr key={r.entry.id} className="border-t border-slate-800">
                    <td className="p-3 whitespace-nowrap">{formatDate(r.entry.startMs, s.timezone, locale)}</td>
                    <td className="p-3 whitespace-nowrap num text-slate-400">
                      {formatTimeOfDay(r.entry.startMs, s.timezone)}
                      {r.entry.endMs != null ? `–${formatTimeOfDay(r.entry.endMs, s.timezone)}` : ''}
                    </td>
                    <td className={`p-3 ${r.entry.billable === 1 ? 'text-slate-300' : 'text-slate-500'}`}>
                      {r.taskName ?? r.entry.description ?? '—'}
                      {r.entry.billable === 0 && (
                        <span className="ms-2 pill bg-slate-800 text-slate-500">{t(locale, 'nonBillable')}</span>
                      )}
                    </td>
                    <td className="p-3 text-end num">{formatHm(r.entry.durationMs ?? 0)}</td>
                    <td className="p-3 text-end whitespace-nowrap">
                      <form action={toggleEntryBillable} className="inline">
                        <input type="hidden" name="entryId" value={r.entry.id} />
                        <input type="hidden" name="projectId" value={project.id} />
                        <button
                          type="submit"
                          className="text-slate-500 hover:text-sky-300 text-xs"
                          title={t(locale, r.entry.billable === 1 ? 'markNonBillable' : 'markBillable')}
                        >
                          {r.entry.billable === 1 ? '⊘' : '↺'}
                        </button>
                      </form>
                      <form action={deleteEntry} className="inline ms-2">
                        <input type="hidden" name="entryId" value={r.entry.id} />
                        <input type="hidden" name="projectId" value={project.id} />
                        <button type="submit" className="text-slate-600 hover:text-red-400" title={t(locale, 'delete')}>
                          ✕
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Edit case */}
      <details className="card">
        <summary className="cursor-pointer font-medium text-slate-300">
          {t(locale, 'edit')} · {t(locale, 'case')}
        </summary>
        <form action={updateProject} className="grid gap-3 md:grid-cols-2 mt-4">
          <input type="hidden" name="id" value={project.id} />
          <input type="hidden" name="clientId" value={client.id} />
          <div>
            <label className="label">{t(locale, 'name')}</label>
            <input name="name" className="input" defaultValue={project.name} required />
          </div>
          <div>
            <label className="label">{t(locale, 'caseNumber')}</label>
            <input name="caseNumber" className="input" defaultValue={project.caseNumber ?? ''} placeholder="2026-0143" />
          </div>
          <div className="md:col-span-2">
            <label className="label">{t(locale, 'description')}</label>
            <input name="description" className="input" defaultValue={project.description ?? ''} />
          </div>
          <div>
            <label className="label">
              {t(locale, 'hourlyRate')} ({currency})
            </label>
            <input
              name="hourlyRate"
              type="number"
              step="0.01"
              min="0"
              className="input"
              defaultValue={project.hourlyRate ?? ''}
              placeholder={String(client.hourlyRate || '')}
            />
          </div>
          <div />
          <div>
            <label className="label">
              {t(locale, 'alertThreshold')} ({t(locale, 'hours')})
            </label>
            <input
              name="alertThresholdHours"
              type="number"
              step="0.5"
              min="0"
              className="input"
              defaultValue={project.alertThresholdHours ?? ''}
              placeholder={t(locale, 'noAlert')}
            />
          </div>
          <div>
            <label className="label">
              {t(locale, 'alertAmount')} ({currency})
            </label>
            <input
              name="alertThresholdAmount"
              type="number"
              step="100"
              min="0"
              className="input"
              defaultValue={project.alertThresholdAmount ?? ''}
              placeholder={t(locale, 'noAlert')}
            />
            <div className="text-xs text-slate-500 mt-1">{t(locale, 'alertAmountHelp')}</div>
          </div>
          <div className="md:col-span-2">
            <button className="btn-primary" type="submit">
              {t(locale, 'save')}
            </button>
          </div>
        </form>
        <div className="mt-3 flex gap-2">
          <form action={setProjectStatus}>
            <input type="hidden" name="id" value={project.id} />
            <input type="hidden" name="clientId" value={client.id} />
            <input type="hidden" name="status" value={project.status === 'open' ? 'closed' : 'open'} />
            <button className="btn-ghost" type="submit">
              {t(locale, project.status === 'open' ? 'close' : 'reopen')}
            </button>
          </form>
          {project.isDefault !== 1 && (
            <form action={archiveProject}>
              <input type="hidden" name="id" value={project.id} />
              <input type="hidden" name="clientId" value={client.id} />
              <button className="btn-danger" type="submit">
                {t(locale, 'archive')}
              </button>
            </form>
          )}
        </div>
      </details>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`num text-2xl font-bold mt-1 ${highlight ? 'text-emerald-300' : ''}`}>{value}</div>
    </div>
  );
}

function Progress({
  label,
  current,
  pct,
  over,
  note,
}: {
  label: string;
  current: string;
  pct: number;
  over: boolean;
  note: string | null;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span>
          {label}
          {note ? <span className="text-amber-400"> · {note}</span> : null}
        </span>
        <span className="num text-slate-400">{current}</span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-slate-800 overflow-hidden">
        <div className={`h-full ${over ? 'bg-amber-500' : 'bg-sky-500'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
