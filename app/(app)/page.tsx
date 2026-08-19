import Link from 'next/link';
import { TimerWidget, type ActiveProps } from '@/components/timer-widget';
import { getSettings, localeOf } from '@/lib/settings';
import { t } from '@/lib/i18n';
import { getClientsTree, hoursInWindow, activeCasesWithHours, recentEntries, upcomingHearings } from '@/lib/queries';
import { getActiveSession } from '@/lib/timer-service';
import { taskSuggestionsByClient } from '@/lib/case-service';
import { resumeTimer, stopTimer, cancelTimer } from '@/lib/actions';
import { startOfDayMs, startOfWeekMs, startOfMonthMs, formatHm } from '@/lib/time';
import { formatDate, money } from '@/lib/format';
import { listInvoices } from '@/lib/invoice-service';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const s = await getSettings();
  const locale = localeOf(s);
  const now = Date.now();

  const [tree, active, suggestions, todayH, weekH, monthH, cases, recent, hearings, allInvoices] = await Promise.all([
    getClientsTree(),
    getActiveSession(),
    taskSuggestionsByClient(),
    hoursInWindow(startOfDayMs(now, s.timezone), now + 1),
    hoursInWindow(startOfWeekMs(now, s.timezone), now + 1),
    hoursInWindow(startOfMonthMs(now, s.timezone), now + 1),
    activeCasesWithHours(),
    recentEntries(12),
    upcomingHearings(6),
    listInvoices(200),
  ]);

  // A live sitting this old is almost always a forgotten timer.
  const LONG_SITTING_MS = 6 * 3_600_000;
  const liveForMs =
    active && active.entry.status === 'running' && active.liveSinceMs != null ? now - active.liveSinceMs : 0;
  const forgotten = liveForMs > LONG_SITTING_MS;

  const unpaid = allInvoices.filter((i) => i.status !== 'paid');
  const unpaidByCurrency = new Map<string, number>();
  for (const i of unpaid) {
    const due = i.total > 0 ? i.total : i.subtotal;
    unpaidByCurrency.set(i.currency, (unpaidByCurrency.get(i.currency) ?? 0) + due);
  }

  const activeProps: ActiveProps | null = active
    ? {
        entryId: active.entry.id,
        status: active.entry.status === 'running' ? 'running' : 'paused',
        bankedMs: active.bankedMs,
        liveSinceMs: active.liveSinceMs,
        clientName: active.clientName,
        projectName: active.projectName,
        taskName: active.taskName ?? active.entry.description,
        sittings: active.segments.length,
      }
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t(locale, 'dashboard')}</h1>
        <Link href="/reports" className="btn-ghost">
          {t(locale, 'reports')}
        </Link>
      </div>

      {forgotten && activeProps ? (
        <div className="card border-red-800/60 bg-red-950/20 flex items-center justify-between gap-4 flex-wrap">
          <div className="text-sm">
            ⏰{' '}
            {t(locale, 'longTimerWarning').replace('{h}', Math.floor(liveForMs / 3_600_000).toString())}
            <div className="text-xs text-slate-400 mt-0.5">
              {activeProps.clientName} · {activeProps.projectName}
            </div>
          </div>
          <div className="flex gap-2">
            <form action={stopTimer}>
              <input type="hidden" name="entryId" value={activeProps.entryId} />
              <button className="btn-primary" type="submit">
                ■ {t(locale, 'stopAndKeep')}
              </button>
            </form>
            <form action={cancelTimer}>
              <input type="hidden" name="entryId" value={activeProps.entryId} />
              <button className="btn-danger" type="submit">
                {t(locale, 'discardSitting')}
              </button>
            </form>
          </div>
        </div>
      ) : null}

      <TimerWidget tree={tree} active={activeProps} suggestions={suggestions} serverNowMs={now} locale={locale} />

      {(hearings.length > 0 || unpaid.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          {hearings.length > 0 ? (
            <div className="card">
              <h2 className="font-semibold mb-2 text-sm">⚖️ {t(locale, 'upcomingHearings')}</h2>
              <ul className="space-y-1.5 text-sm">
                {hearings.map((h) => (
                  <li key={h.projectId} className="flex items-center justify-between gap-2">
                    <Link href={`/cases/${h.projectId}`} className="truncate hover:text-sky-300">
                      <span className="text-slate-400">{h.clientName} · </span>
                      {h.caseNumber ? <span className="text-slate-500">{h.caseNumber} · </span> : null}
                      {h.projectName}
                    </Link>
                    <span className="num text-slate-300 shrink-0">{formatDate(h.hearingDate, s.timezone, locale)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {unpaid.length > 0 ? (
            <Link href="/invoices" className="card block hover:border-amber-700/60 transition">
              <h2 className="font-semibold mb-1 text-sm text-amber-300">💰 {t(locale, 'outstanding')}</h2>
              <div className="num text-2xl font-bold">
                {[...unpaidByCurrency.entries()].map(([cur, sum]) => money(sum, cur, locale)).join(' + ')}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                {unpaid.length} {t(locale, 'invoices')}
              </div>
            </Link>
          ) : null}
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <Stat label={t(locale, 'today')} value={todayH} />
        <Stat label={t(locale, 'thisWeek')} value={weekH} />
        <Stat label={t(locale, 'thisMonth')} value={monthH} />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="card">
          <h2 className="font-semibold mb-3">{t(locale, 'activeCases')}</h2>
          {cases.length === 0 ? (
            <p className="text-sm text-slate-500">{t(locale, 'noCases')}</p>
          ) : (
            <ul className="space-y-3">
              {cases.slice(0, 8).map((c) => {
                const thr = c.project.alertThresholdHours;
                const pct = thr && thr > 0 ? Math.min(100, (c.hours / thr) * 100) : null;
                const over = thr != null && thr > 0 && c.hours >= thr;
                return (
                  <li key={c.project.id}>
                    <Link href={`/cases/${c.project.id}`} className="flex items-center justify-between text-sm hover:text-sky-300">
                      <span className="truncate">
                        <span className="text-slate-400">{c.clientName} · </span>
                        {c.project.name}
                      </span>
                      <span className={`num ${over ? 'text-amber-400' : 'text-slate-300'}`}>
                        {c.hours.toFixed(2)}
                        {thr ? <span className="text-slate-500"> / {thr.toFixed(0)}</span> : null}
                      </span>
                    </Link>
                    {pct != null && (
                      <div className="mt-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                        <div className={`h-full ${over ? 'bg-amber-500' : 'bg-sky-500'}`} style={{ width: `${pct}%` }} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="card">
          <h2 className="font-semibold mb-3">{t(locale, 'recentEntries')}</h2>
          {recent.length === 0 ? (
            <p className="text-sm text-slate-500">{t(locale, 'noEntries')}</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {recent.map((r) => (
                <li key={r.entry.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    <span className="text-slate-500">{formatDate(r.entry.startMs, s.timezone, locale)} · </span>
                    {r.clientName} · {r.projectName}
                    {r.taskName ? <span className="text-slate-500"> · {r.taskName}</span> : null}
                    {r.entry.status === 'paused' ? (
                      <span className="pill bg-amber-950 text-amber-300 ms-2">{t(locale, 'paused')}</span>
                    ) : null}
                    {r.entry.billable === 0 ? (
                      <span className="pill bg-slate-800 text-slate-400 ms-2">{t(locale, 'unbilled')}</span>
                    ) : null}
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className="num text-slate-300">{formatHm(r.entry.durationMs ?? 0)}</span>
                    {/* Carry on with this task — the gap becomes a visible break. */}
                    <form action={resumeTimer}>
                      <input type="hidden" name="entryId" value={r.entry.id} />
                      <button
                        type="submit"
                        className="text-slate-500 hover:text-emerald-400 text-xs"
                        title={t(locale, 'resumeTask')}
                      >
                        ▶
                      </button>
                    </form>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="num text-3xl font-bold mt-1">{value.toFixed(2)}</div>
      <div className="text-xs text-slate-500">שעות · hours</div>
    </div>
  );
}
