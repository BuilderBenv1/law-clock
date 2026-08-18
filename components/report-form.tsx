'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Locale } from '@/lib/i18n';
import { t } from '@/lib/i18n';

export interface ReportFormClient {
  id: string;
  name: string;
  projects: { id: string; name: string; caseNumber: string | null }[];
}

function toDateInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function ReportForm({
  clients,
  locale,
  initial,
}: {
  clients: ReportFormClient[];
  locale: Locale;
  initial: { clientId: string; projectId: string; fromMs: number; toMs: number; allTime: boolean };
}) {
  const router = useRouter();
  const [clientId, setClientId] = useState(initial.clientId);
  const [projectId, setProjectId] = useState(initial.projectId);
  const [allTime, setAllTime] = useState(initial.allTime);
  const [from, setFrom] = useState(toDateInput(initial.fromMs));
  const [to, setTo] = useState(toDateInput(Math.max(initial.fromMs, initial.toMs - 1)));

  const projects = useMemo(() => clients.find((c) => c.id === clientId)?.projects ?? [], [clients, clientId]);

  function go(nextAllTime = allTime, range?: { from: string; to: string }) {
    if (!clientId) return;
    const q = new URLSearchParams({ clientId });
    if (projectId) q.set('projectId', projectId);
    if (nextAllTime) {
      q.set('allTime', '1');
    } else {
      const f = range?.from ?? from;
      const tt = range?.to ?? to;
      q.set('from', String(new Date(`${f}T00:00:00`).getTime()));
      q.set('to', String(new Date(`${tt}T00:00:00`).getTime() + 24 * 3600 * 1000));
    }
    router.push(`/reports?${q.toString()}`);
  }

  /** Jump to a whole calendar month relative to now. */
  function setMonth(offset: number) {
    const now = new Date();
    const first = toDateInput(new Date(now.getFullYear(), now.getMonth() + offset, 1).getTime());
    const last = toDateInput(new Date(now.getFullYear(), now.getMonth() + offset + 1, 0).getTime());
    setAllTime(false);
    setFrom(first);
    setTo(last);
    go(false, { from: first, to: last });
  }

  return (
    <form
      className="card space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="label">{t(locale, 'client')}</label>
          <select
            className="input"
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              setProjectId('');
            }}
            required
          >
            <option value="">{t(locale, 'pickClient')}</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t(locale, 'case')}</label>
          <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={!clientId}>
            <option value="">{t(locale, 'allCases')}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.caseNumber ? `${p.caseNumber} · ${p.name}` : p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* All time is the common case for a running matter, so it leads. */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          className={allTime ? 'btn-primary' : 'btn-ghost'}
          onClick={() => {
            setAllTime(true);
            go(true);
          }}
          disabled={!clientId}
        >
          ∞ {t(locale, 'allTime')}
        </button>
        <button type="button" className="btn-ghost" onClick={() => setMonth(0)} disabled={!clientId}>
          {t(locale, 'thisMonth')}
        </button>
        <button type="button" className="btn-ghost" onClick={() => setMonth(-1)} disabled={!clientId}>
          {t(locale, 'lastMonth')}
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-3 items-end">
        <div>
          <label className="label">{t(locale, 'from')}</label>
          <input
            type="date"
            className="input"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setAllTime(false);
            }}
          />
        </div>
        <div>
          <label className="label">{t(locale, 'to')}</label>
          <input
            type="date"
            className="input"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setAllTime(false);
            }}
          />
        </div>
        <button type="submit" className="btn-primary" disabled={!clientId}>
          {t(locale, 'dateRange')}
        </button>
      </div>
    </form>
  );
}
