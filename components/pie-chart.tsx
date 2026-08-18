/**
 * Part-to-whole donut for "where did the time go".
 *
 * Deliberately capped at six wedges — beyond that adjacent slices blur and the
 * chart stops answering anything — so the tail is folded into a single "Other"
 * wedge and the full numbers stay available in the tables below. Identity is
 * never carried by colour alone: every wedge is repeated in the legend with its
 * hours and share.
 */

/** Categorical hues in fixed slot order, stepped for a dark surface. */
const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300'];
/** Painted between wedges so they read as separate marks. */
const SURFACE = '#111a2e';
const MAX_SLICES = 6;

export interface Slice {
  label: string;
  value: number;
}

interface Wedge extends Slice {
  color: string;
  pct: number;
}

function polar(cx: number, cy: number, r: number, angle: number): [number, number] {
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
}

/** Fold everything past the fifth slice into one "Other" wedge. */
function toWedges(slices: Slice[], total: number, otherLabel: string): Wedge[] {
  const sorted = [...slices].filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, MAX_SLICES - 1);
  const tail = sorted.slice(MAX_SLICES - 1);
  const merged =
    tail.length > 0
      ? [...head, { label: otherLabel, value: tail.reduce((sum, s) => sum + s.value, 0) }]
      : head;
  return merged.map((s, i) => ({
    ...s,
    color: SERIES[i % SERIES.length]!,
    pct: total > 0 ? s.value / total : 0,
  }));
}

export function PieChart({
  slices,
  title,
  centerLabel,
  otherLabel = 'Other',
  formatValue,
  size = 168,
}: {
  slices: Slice[];
  title: string;
  centerLabel: string;
  otherLabel?: string;
  formatValue: (n: number) => string;
  size?: number;
}) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const wedges = toWedges(slices, total, otherLabel);

  if (wedges.length === 0 || total <= 0) return null;

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 3;
  const ir = r * 0.58;

  let angle = -Math.PI / 2;
  const paths = wedges.map((w) => {
    const sweep = w.pct * Math.PI * 2;
    const a0 = angle;
    const a1 = angle + sweep;
    angle = a1;

    // A lone wedge is a full turn, where the arc command degenerates — draw a ring.
    if (w.pct >= 0.9999) {
      return (
        <circle
          key={w.label}
          cx={cx}
          cy={cy}
          r={(r + ir) / 2}
          fill="none"
          stroke={w.color}
          strokeWidth={r - ir}
        >
          <title>{`${w.label} — ${formatValue(w.value)} (100%)`}</title>
        </circle>
      );
    }

    const large = sweep > Math.PI ? 1 : 0;
    const [x0, y0] = polar(cx, cy, r, a0);
    const [x1, y1] = polar(cx, cy, r, a1);
    const [xi1, yi1] = polar(cx, cy, ir, a1);
    const [xi0, yi0] = polar(cx, cy, ir, a0);
    const d = [
      `M ${x0} ${y0}`,
      `A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`,
      `L ${xi1} ${yi1}`,
      `A ${ir} ${ir} 0 ${large} 0 ${xi0} ${yi0}`,
      'Z',
    ].join(' ');

    return (
      <path key={w.label} d={d} fill={w.color} stroke={SURFACE} strokeWidth={2}>
        <title>{`${w.label} — ${formatValue(w.value)} (${Math.round(w.pct * 100)}%)`}</title>
      </path>
    );
  });

  return (
    <div className="card">
      <h3 className="font-semibold text-sm mb-3">{title}</h3>
      <div className="flex items-center gap-5 flex-wrap">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={title} className="shrink-0">
          {paths}
          <text
            x={cx}
            y={cy - 3}
            textAnchor="middle"
            className="fill-slate-100"
            style={{ fontSize: 19, fontWeight: 700 }}
          >
            {formatValue(total)}
          </text>
          <text x={cx} y={cy + 13} textAnchor="middle" className="fill-slate-500" style={{ fontSize: 9 }}>
            {centerLabel}
          </text>
        </svg>

        <ul className="flex-1 min-w-[160px] space-y-1.5 text-sm">
          {wedges.map((w) => (
            <li key={w.label} className="flex items-center gap-2">
              <span
                aria-hidden
                className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                style={{ background: w.color }}
              />
              <span className="truncate text-slate-300 flex-1">{w.label}</span>
              <span className="num text-slate-400 shrink-0">{formatValue(w.value)}</span>
              <span className="num text-slate-600 shrink-0 w-9 text-end">{Math.round(w.pct * 100)}%</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
