'use client';

import { useEffect, useMemo, useState } from 'react';
import { startTimer, pauseTimer, cancelTimer } from '@/lib/actions';
import type { ClientTreeNode } from '@/lib/queries';
import type { Locale } from '@/lib/i18n';
import { t } from '@/lib/i18n';
import { formatClock } from '@/lib/time';
import { Combobox } from './combobox';

const NEW = '__new__';
const DEFAULT_CASE = '__default__';

interface RunningProps {
  entryId: string;
  startMs: number;
  clientName: string;
  projectName: string;
  taskName: string | null;
}

export function TimerWidget({
  tree,
  running,
  locale,
  serverNowMs,
}: {
  tree: ClientTreeNode[];
  running: RunningProps | null;
  locale: Locale;
  /** The server's clock at render time — see RunningTimer for why it matters. */
  serverNowMs: number;
}) {
  if (running) return <RunningTimer running={running} locale={locale} serverNowMs={serverNowMs} />;
  return <IdleTimer tree={tree} locale={locale} />;
}

function RunningTimer({
  running,
  locale,
  serverNowMs,
}: {
  running: RunningProps;
  locale: Locale;
  serverNowMs: number;
}) {
  /**
   * `startMs` is stamped from the server's clock, but the ticking happens on the
   * browser's. If the two disagree — and on a desktop PC they routinely drift by
   * minutes — subtracting one from the other makes a brand-new timer open at
   * something like 1:41 instead of 0:00. Measuring the offset once at mount and
   * correcting for it makes the clock start at zero on any machine.
   */
  const [skew] = useState(() => Date.now() - serverNowMs);
  const [now, setNow] = useState(() => Date.now() - skew);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() - skew), 1000);
    return () => clearInterval(id);
  }, [skew]);

  const elapsed = Math.max(0, now - running.startMs);

  return (
    <div className="card border-emerald-700/60 bg-emerald-950/20">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-emerald-400 text-xs font-medium mb-1">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            {t(locale, 'running')}
          </div>
          <div className="text-lg font-semibold truncate">
            {running.taskName || t(locale, 'timer')}
          </div>
          <div className="text-xs text-slate-400 truncate">
            {running.clientName} · {running.projectName}
          </div>
        </div>

        <div className="num text-4xl font-bold tabular-nums tracking-tight text-emerald-300">
          {formatClock(elapsed)}
        </div>

        <div className="flex gap-2">
          <form action={pauseTimer}>
            <input type="hidden" name="entryId" value={running.entryId} />
            <button className="btn-green text-base px-5" type="submit">
              ⏸ {t(locale, 'pause')}
            </button>
          </form>
          <form action={cancelTimer}>
            <input type="hidden" name="entryId" value={running.entryId} />
            <button className="btn-ghost" type="submit">
              {t(locale, 'cancel')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function IdleTimer({ tree, locale }: { tree: ClientTreeNode[]; locale: Locale }) {
  const [clientId, setClientId] = useState('');
  const [projectId, setProjectId] = useState(DEFAULT_CASE);

  const client = useMemo(() => tree.find((c) => c.id === clientId), [tree, clientId]);
  const cases = client?.projects ?? [];
  const creatingClient = clientId === NEW;
  const creatingCase = projectId === NEW;
  const canStart = creatingClient || !!clientId;

  return (
    <div className="card">
      <div className="text-slate-400 text-xs font-medium mb-3">{t(locale, 'noRunningTimer')}</div>

      <form action={startTimer} className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          {/* Client — with inline creation */}
          <div>
            <label className="label">{t(locale, 'client')}</label>
            <select
              name="clientId"
              className="input"
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value);
                setProjectId(DEFAULT_CASE);
              }}
              required
            >
              <option value="">{t(locale, 'pickClient')}</option>
              {tree.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value={NEW}>＋ {t(locale, 'newClient')}…</option>
            </select>
            {creatingClient && (
              <input
                name="newClientName"
                className="input mt-2"
                placeholder={t(locale, 'newClient')}
                autoFocus
                required
              />
            )}
          </div>

          {/* Case — defaults to the client's catch-all, with inline creation */}
          <div>
            <label className="label">{t(locale, 'case')}</label>
            <select
              name="projectId"
              className="input"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              disabled={!clientId}
            >
              <option value={DEFAULT_CASE}>
                {t(locale, 'generalCase')} — {t(locale, 'generalCaseHint')}
              </option>
              {cases
                .filter((p) => !p.isDefault)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.caseNumber ? `${p.caseNumber} · ${p.name}` : p.name}
                  </option>
                ))}
              <option value={NEW}>＋ {t(locale, 'newCase')}…</option>
            </select>
            {creatingCase && (
              <div className="grid grid-cols-3 gap-2 mt-2">
                <input
                  name="newCaseName"
                  className="input col-span-2"
                  placeholder={t(locale, 'newCase')}
                  autoFocus
                  required
                />
                <input name="newCaseNumber" className="input" placeholder={t(locale, 'caseNumber')} />
              </div>
            )}
          </div>
        </div>

        {/* What are you working on — free text, with previous tasks as a picker */}
        <div>
          <label className="label">{t(locale, 'taskLabel')}</label>
          <Combobox
            name="taskName"
            options={client?.taskNames ?? []}
            placeholder={t(locale, 'taskPickerHint')}
            emptyHint={t(locale, 'previousTasks')}
          />
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <input type="checkbox" name="nonBillable" value="1" className="w-4 h-4" />
            {t(locale, 'markNonBillable')}
          </label>
          <button className="btn-green px-6 text-base" type="submit" disabled={!canStart}>
            ▶ {t(locale, 'startTimer')}
          </button>
        </div>
      </form>
    </div>
  );
}
