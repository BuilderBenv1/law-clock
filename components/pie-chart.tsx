import type { Locale } from '@/lib/i18n';

export interface Slice {
  label: string;
  value: number;
}

/**
 * Small donut chart drawn as inline SVG — no charting dependency, renders on the
 * server, and prints cleanly. Slices below a percent of the total are folded
 * into an "other" wedge so the legend stays readable.
 */
const PALETTE = ['#38bdf8', '#34d399', '#a78bfa', '#fbbf24', '#f472b6', '#22d3ee', '#fb923c', '#4ade80', '#c084fc'];

function polar(cx: number, cy: number, r: number, angle: number): [number, number] {
  const a = ((angle - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function arcPath(cx: number, cy: number, rOuter: number, rInner: number, from: number, to: number): string {
  // A full circle can't be expressed as a single arc — nudge it just short.
  const sweep = Math.min(to - from, 359.999);
  const end = from + sweep;
  const [x1, y1] = polar(cx, cy, rOuter, from);
  const [x2, y2] = polar(cx, cy, rOuter, end);
  const [x3, y3] = polar(cx, cy, rInner, end);
  const [x4, y4] = polar(cx, cy, rInner, from);
  const large = sweep > 180 ? 1 : 0;
  return [
    `M ${x1} ${y1}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${x4} ${y4}`,
    'Z',
  ].join(' ');
}

export function PieChart({
  slices,
  title,
  unit,
  locale,
  maxSlices = 7,
}: {
  slices: Slice[];
  title: string;
  unit?: string;
  locale: Locale;
  maxSlices?: number;
}) {
  const positive = slices.filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  const total = positive.reduce((a, s) => a + s.value, 0);

  if (total <= 0) {
    return (
      <div className="card">
        <h3 className="font-semibold mb-2 text-sm">{title}</h3>
        <p className="text-xs text-slate-500">—</p>
      </div>
    );
  }

  const head = positive.slice(0, maxSlices);
  const tail = positive.slice(maxSlices);
  const shown: Slice[] =
    tail.length > 0
      ? [...head, { label: locale === 'he' ? 'אחר' : 'Other', value: tail.reduce((a, s) => a + s.value, 0) }]
      : head;

  let angle = 0;
  const wedges = shown.map((s, i) => {
    const sweep = (s.value / total) * 360;
    const d = arcPath(60, 60, 56, 33, angle, angle + sweep);
    angle += sweep;
    return { d, color: PALETTE[i % PALETTE.length]!, ...s, pct: (s.value / total) * 100 };
  });

  return (
    <div className="card">
      <h3 className="font-semibold mb-3 text-sm">{title}</h3>
      <div className="flex items-center gap-5 flex-wrap">
        <svg viewBox="0 0 120 120" className="w-[120px] h-[120px] shrink-0" role="img" aria-label={title}>
          {wedges.map((w) => (
            <path key={w.label} d={w.d} fill={w.color} stroke="#0b1220" strokeWidth="1" />
          ))}
          <text
            x="60"
            y="57"
            textAnchor="middle"
            className="fill-slate-200"
            style={{ fontSize: '15px', fontWeight: 700 }}
          >
            {total.toFixed(1)}
          </text>
          {unit ? (
            <text x="60" y="70" textAnchor="middle" className="fill-slate-500" style={{ fontSize: '8px' }}>
              {unit}
            </text>
          ) : null}
        </svg>

        <ul className="text-xs space-y-1.5 min-w-[150px] flex-1">
          {wedges.map((w) => (
            <li key={w.label} className="flex items-center gap-2">
              <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: w.color }} />
              <span className="truncate flex-1 text-slate-300" title={w.label}>
                {w.label}
              </span>
              <span className="num text-slate-400 shrink-0">
                {w.value.toFixed(2)} · {w.pct.toFixed(0)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
