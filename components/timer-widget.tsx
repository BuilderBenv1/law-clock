'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { startTimer, stopTimer, pauseTimer, resumeTimer, cancelTimer, quickCreateClient, quickCreateCase } from '@/lib/actions';
import type { ClientTreeNode } from '@/lib/queries';
import type { Locale } from '@/lib/i18n';
import { t } from '@/lib/i18n';
import { formatClock } from '@/lib/time';

export interface ActiveProps {
  entryId: string;
  status: 'running' | 'paused';
  /** Worked ms already banked in closed sittings. */
  bankedMs: number;
  /** Server clock ms when the live sitting began; null while paused. */
  liveSinceMs: number | null;
  clientName: string;
  projectName: string;
  taskName: string | null;
  /** How many sittings so far — >1 means it has been paused before. */
  sittings: number;
}

/**
 * The browser clock and the server clock are rarely in sync — on a hosted app
 * they can differ by minutes, which is why the timer used to open at 1:41.
 * Every timestamp comes from the server, so measure the offset once against the
 * server's "now" and subtract it from each local reading.
 */
function useServerNow(serverNowMs: number): () => number {
  const skewRef = useRef(0);
  const [, force] = useState(0);
  useEffect(() => {
    skewRef.current = Date.now() - serverNowMs;
    force((n) => n + 1);
  }, [serverNowMs]);
  return () => Date.now() - skewRef.current;
}

export function TimerWidget({
  tree,
  active,
  suggestions,
  serverNowMs,
  locale,
}: {
  tree: ClientTreeNode[];
  active: ActiveProps | null;
  /** Previously-used task titles per client id. */
  suggestions: Record<string, string[]>;
  serverNowMs: number;
  locale: Locale;
}) {
  if (active) return <ActiveTimer active={active} serverNowMs={serverNowMs} locale={locale} />;
  return <IdleTimer tree={tree} suggestions={suggestions} locale={locale} />;
}

function ActiveTimer({ active, serverNowMs, locale }: { active: ActiveProps; serverNowMs: number; locale: Locale }) {
  const now = useServerNow(serverNowMs);
  const [tick, setTick] = useState(0);
  const running = active.status === 'running';

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  void tick; // the interval exists to drive this re-render
  const elapsed = active.bankedMs + (running && active.liveSinceMs != null ? Math.max(0, now() - active.liveSinceMs) : 0);

  return (
    <div className={`card ${running ? 'border-emerald-700/60 bg-emerald-950/20' : 'border-amber-700/60 bg-amber-950/20'}`}>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className={`flex items-center gap-2 text-xs font-medium mb-1 ${running ? 'text-emerald-400' : 'text-amber-400'}`}>
            <span className={`inline-block w-2 h-2 rounded-full ${running ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
            {running ? t(locale, 'running') : t(locale, 'paused')}
            {active.sittings > 1 ? (
              <span className="text-slate-500">
                · {active.sittings} {t(locale, 'sittings')}
              </span>
            ) : null}
          </div>
          <div className="text-lg font-semibold truncate">
            {active.clientName} · {active.projectName}
          </div>
          {active.taskName ? <div className="text-sm text-slate-400 truncate">{active.taskName}</div> : null}
        </div>

        <div className={`num text-4xl font-bold tabular-nums tracking-tight ${running ? 'text-emerald-300' : 'text-amber-300'}`}>
          {formatClock(elapsed)}
        </div>

        <div className="flex gap-2 flex-wrap">
          {running ? (
            <form action={pauseTimer}>
              <input type="hidden" name="entryId" value={active.entryId} />
              <button className="btn-amber" type="submit">
                ❙❙ {t(locale, 'pause')}
              </button>
            </form>
          ) : (
            <form action={resumeTimer}>
              <input type="hidden" name="entryId" value={active.entryId} />
              <button className="btn-green" type="submit">
                ▶ {t(locale, 'resume')}
              </button>
            </form>
          )}
          <form action={stopTimer}>
            <input type="hidden" name="entryId" value={active.entryId} />
            <button className="btn-primary" type="submit">
              ■ {t(locale, 'stopTimer')}
            </button>
          </form>
          <form action={cancelTimer}>
            <input type="hidden" name="entryId" value={active.entryId} />
            <button className="btn-ghost" type="submit">
              {t(locale, 'cancel')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

const NEW_VALUE = '__new__';

function IdleTimer({
  tree,
  suggestions,
  locale,
}: {
  tree: ClientTreeNode[];
  suggestions: Record<string, string[]>;
  locale: Locale;
}) {
  const [clients, setClients] = useState(tree);
  const [clientId, setClientId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [title, setTitle] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState('');

  const projects = useMemo(() => clients.find((c) => c.id === clientId)?.projects ?? [], [clients, clientId]);

  /** Past titles for this client first, then any task defined on its cases. */
  const titleOptions = useMemo(() => {
    const merged = [...(suggestions[clientId] ?? []), ...projects.flatMap((p) => p.tasks.map((tk) => tk.name))];
    const seen = new Set<string>();
    return merged.filter((n) => {
      const k = n.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [suggestions, clientId, projects]);

  function onClientChange(value: string) {
    setError('');
    if (value !== NEW_VALUE) {
      setClientId(value);
      setProjectId('');
      return;
    }
    const name = window.prompt(t(locale, 'newClientPrompt'));
    if (!name?.trim()) return;
    startTransition(async () => {
      try {
        const created = await quickCreateClient(name);
        setClients((prev) => [...prev, { id: created.id, name: created.name, projects: [] }]);
        setClientId(created.id);
        setProjectId('');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function onProjectChange(value: string) {
    setError('');
    if (value !== NEW_VALUE) {
      setProjectId(value);
      return;
    }
    const name = window.prompt(t(locale, 'newCasePrompt'));
    if (!name?.trim()) return;
    const number = (window.prompt(t(locale, 'newCaseNumberPrompt')) ?? '').trim();
    startTransition(async () => {
      try {
        const created = await quickCreateCase(clientId, name, number);
        setClients((prev) =>
          prev.map((c) =>
            c.id === clientId
              ? {
                  ...c,
                  projects: [...c.projects, { id: created.id, name: created.name, caseNumber: number || null, isDefault: false, tasks: [] }],
                }
              : c,
          ),
        );
        setProjectId(created.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return (
    <div className="card">
      <div className="flex items-center gap-2 text-slate-400 text-xs font-medium mb-3">{t(locale, 'noRunningTimer')}</div>
      <form action={startTimer} className="grid gap-3 md:grid-cols-4">
        <div>
          <label className="label">{t(locale, 'client')}</label>
          <select name="clientId" className="input" value={clientId} onChange={(e) => onClientChange(e.target.value)} required>
            <option value="">{t(locale, 'pickClient')}</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value={NEW_VALUE}>＋ {t(locale, 'addClient')}…</option>
          </select>
        </div>

        <div>
          <label className="label">
            {t(locale, 'case')} <span className="text-slate-600">({t(locale, 'optional')})</span>
          </label>
          <select name="projectId" className="input" value={projectId} onChange={(e) => onProjectChange(e.target.value)} disabled={!clientId}>
            <option value="">{t(locale, 'uncategorised')}</option>
            {projects
              .filter((p) => !p.isDefault)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.caseNumber ? `${p.caseNumber} · ${p.name}` : p.name}
                </option>
              ))}
            <option value={NEW_VALUE}>＋ {t(locale, 'addCase')}…</option>
          </select>
        </div>

        <div className="md:col-span-2">
          <label className="label">{t(locale, 'whatWorkingOn')}</label>
          <input
            name="title"
            className="input"
            list="task-suggestions"
            autoComplete="off"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t(locale, 'titlePlaceholder')}
          />
          <datalist id="task-suggestions">
            {titleOptions.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          {titleOptions.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {titleOptions.slice(0, 6).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setTitle(n)}
                  className="pill bg-slate-800 text-slate-300 hover:bg-slate-700 max-w-[220px] truncate"
                  title={n}
                >
                  {n}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="md:col-span-4 flex items-center gap-3">
          <button className="btn-green" type="submit" disabled={!clientId || pending}>
            ▶ {t(locale, 'startTimer')}
          </button>
          {pending ? <span className="text-xs text-slate-500">…</span> : null}
          {error ? <span className="text-xs text-red-400">{error}</span> : null}
        </div>
      </form>
    </div>
  );
}
