/**
 * Minimal bidirectional text support for PDF drawing.
 *
 * pdf-lib paints glyphs strictly in the order the string gives them, and it has
 * no notion of the Unicode bidi algorithm. Hebrew is stored in *logical* order
 * (first letter typed first) but must be painted in *visual* order (first letter
 * rightmost), so every Hebrew run has to be reversed before it is drawn.
 *
 * This implements the practical subset of UAX#9 that legal documents need:
 * Hebrew runs, embedded Latin words, numbers/dates/money kept left-to-right, and
 * mirrored brackets. It is not a full bidi engine — it does not handle Arabic
 * shaping or nested explicit embedding levels, neither of which occurs here.
 */

const RTL_CHAR = /[֐-׿יִ-ﭏ]/;
/** Unconditionally left-to-right: Latin letters and digits. */
const LTR_CHAR = /[A-Za-z0-9]/;
/**
 * Punctuation that glues left-to-right text together — the dots in a date, the
 * separators in 1,234.50, the @ and dots of an email, the dashes of a phone
 * number. It counts as left-to-right only when it sits *between* two such
 * characters; a comma at the end of "12," is ordinary trailing punctuation and
 * belongs to the Hebrew sentence around it.
 */
const CONNECTOR = /[@#$%&*_+=\/\.,:;'"~^`|-]/;

const MIRRORED: Record<string, string> = {
  '(': ')',
  ')': '(',
  '[': ']',
  ']': '[',
  '{': '}',
  '}': '{',
  '<': '>',
  '>': '<',
  '«': '»',
  '»': '«',
};

type Dir = 'rtl' | 'ltr' | 'neutral';

function classify(ch: string): Dir {
  if (RTL_CHAR.test(ch)) return 'rtl';
  if (LTR_CHAR.test(ch)) return 'ltr';
  return 'neutral';
}

/** True when the string contains any Hebrew character. */
export function hasRtl(text: string): boolean {
  return RTL_CHAR.test(text);
}

interface Run {
  dir: Dir;
  text: string;
}

/**
 * Classify a whole line, promoting connector punctuation to left-to-right only
 * where it genuinely sits inside a left-to-right token (UAX#9 rules CS/ES). That
 * keeps "18.08.2026" and "1,234.50" intact while leaving a trailing comma to the
 * Hebrew sentence around it.
 */
function classifyAll(chars: string[]): Dir[] {
  const dirs = chars.map(classify);
  for (let i = 0; i < chars.length; i++) {
    if (dirs[i] !== 'neutral' || !CONNECTOR.test(chars[i]!)) continue;
    // Skip past neighbouring connectors so "12.5.2026" resolves as one token.
    let left = i - 1;
    while (left >= 0 && CONNECTOR.test(chars[left]!)) left--;
    let right = i + 1;
    while (right < chars.length && CONNECTOR.test(chars[right]!)) right++;
    if (dirs[left] === 'ltr' && dirs[right] === 'ltr') dirs[i] = 'ltr';
  }
  return dirs;
}

function toRuns(text: string): Run[] {
  const chars = [...text];
  const dirs = classifyAll(chars);
  const runs: Run[] = [];
  chars.forEach((ch, i) => {
    const dir = dirs[i]!;
    const last = runs[runs.length - 1];
    if (last && last.dir === dir) last.text += ch;
    else runs.push({ dir, text: ch });
  });
  return resolveNeutrals(runs);
}

/**
 * UAX#9 rule N1: a neutral run flanked by the same strong direction takes that
 * direction; otherwise it falls back to the paragraph direction (RTL here).
 * Without this, "Dor Iluz" — two Latin runs joined by a neutral space — would
 * have its words painted in reverse order.
 */
function resolveNeutrals(runs: Run[]): Run[] {
  const resolved = runs.map((run, i) => {
    if (run.dir !== 'neutral') return run;
    const prev = runs[i - 1];
    const next = runs[i + 1];
    return prev?.dir === 'ltr' && next?.dir === 'ltr' ? { dir: 'ltr' as Dir, text: run.text } : run;
  });

  // Merge neighbours that now share a direction so LTR blocks stay contiguous.
  const merged: Run[] = [];
  for (const run of resolved) {
    const last = merged[merged.length - 1];
    if (last && last.dir === run.dir) last.text += run.text;
    else merged.push({ ...run });
  }
  return merged;
}

/**
 * Reorder one line of logical-order text into the visual order pdf-lib should
 * paint, for a right-to-left paragraph.
 *
 * The whole line is reversed, then each left-to-right run (Latin words, numbers,
 * money, dates) is flipped back so it reads correctly, and mirrored brackets are
 * swapped. Neutral runs — spaces and punctuation — travel with the reversal,
 * which is what puts a sentence-final period at the visual left end.
 */
export function visualRtl(text: string): string {
  if (!text) return '';
  const runs = toRuns(text);
  const out: string[] = [];
  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i]!;
    if (run.dir === 'ltr') {
      out.push(run.text);
    } else {
      out.push(
        [...run.text]
          .reverse()
          .map((c) => MIRRORED[c] ?? c)
          .join(''),
      );
    }
  }
  return out.join('');
}

/**
 * Prepare a string for `pdf-lib`'s `drawText`.
 *
 * fontkit — which pdf-lib uses to lay glyphs out — detects Hebrew script and
 * already paints the run right-to-left, so handing it fully reordered text would
 * reverse it a second time and leave the Hebrew unreadable. What fontkit gets
 * wrong is that it reverses *everything* in the run, including embedded numbers,
 * dates and Latin words: "12," comes out as ",21".
 *
 * So the text stays in logical order and only the left-to-right islands are
 * flipped in advance. fontkit's own reversal then turns those islands the right
 * way round again while ordering the Hebrew correctly — one reversal each, in
 * the right places.
 *
 * Strings with no Hebrew are returned untouched: fontkit leaves them alone, and
 * so must we, or English mode would come out backwards.
 */
export function shape(text: string | null | undefined): string {
  const s = String(text ?? '');
  if (!hasRtl(s)) return s;
  return toRuns(s)
    .map((run) =>
      run.dir === 'ltr'
        ? [...run.text].reverse().join('')
        : // fontkit reverses these runs but does not mirror brackets, so a "("
          // would end up opening the wrong way. Swap it for its pair up front.
          [...run.text].map((c) => MIRRORED[c] ?? c).join(''),
    )
    .join('');
}
