/**
 * Regression guard for PDF text direction.
 *
 * The rule that is easy to break: `shape()` does NOT return visual order. fontkit
 * reverses Hebrew runs itself when pdf-lib lays the text out, so `shape()` only
 * pre-flips the left-to-right islands and mirrors brackets; fontkit's reversal
 * then produces the correct visual order.
 *
 * The invariant below states exactly that — reversing what `shape()` returns
 * must give the true visual order — so a future "fix" that reverses twice, or
 * stops reversing at all, fails here instead of on a client's invoice.
 *
 * Run: npm run check:bidi
 */
import assert from 'node:assert/strict';
import { shape, visualRtl, hasRtl } from '../lib/pdf/bidi';

/** What a Hebrew reader must see, painted left to right. */
const VISUAL_CASES: [string, string][] = [
  ['הופק בתאריך 18.08.2026', '18.08.2026 ךיראתב קפוה'],
  ['רחוב הרצל 12, תל אביב', 'ביבא לת ,12 לצרה בוחר'],
  ['סה"כ 1,234.50 ₪', '₪ 1,234.50 כ"הס'],
  ['דוא"ל office@iluzlaw.com', 'office@iluzlaw.com ל"אוד'],
  ['טלפון 03-1234567', '03-1234567 ןופלט'],
  ['תיק 2026-0143 כהן', 'ןהכ 2026-0143 קית'],
  ['עו"ד Dor Iluz', 'Dor Iluz ד"וע'],
  ['הערה (חשוב) כאן', 'ןאכ (בושח) הרעה'],
];

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (e) {
    failures++;
    console.error(`FAIL  ${name}\n      ${(e as Error).message.split('\n')[0]}`);
  }
}

for (const [logical, expectedVisual] of VISUAL_CASES) {
  check(`visual order: ${logical}`, () => assert.equal(visualRtl(logical), expectedVisual));

  // The contract with fontkit: it reverses our output, so reversing our output
  // by hand must land on the visual order above.
  check(`fontkit round-trip: ${logical}`, () => {
    const afterFontkit = [...shape(logical)].reverse().join('');
    assert.equal(afterFontkit, expectedVisual);
  });
}

check('numbers survive: 12 does not become 21', () => {
  const afterFontkit = [...shape('רחוב הרצל 12, תל אביב')].reverse().join('');
  assert.ok(afterFontkit.includes('12'), 'digits reversed');
  assert.ok(!afterFontkit.includes('21'), 'digits reversed');
});

check('Latin-only text is left untouched', () => {
  assert.equal(shape('Invoice 2026-0004 total 1,234.50'), 'Invoice 2026-0004 total 1,234.50');
  assert.equal(hasRtl('Invoice 2026'), false);
});

check('empty and nullish are safe', () => {
  assert.equal(shape(''), '');
  assert.equal(shape(null), '');
  assert.equal(shape(undefined), '');
});

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
