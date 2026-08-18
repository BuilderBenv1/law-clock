import { PDFDocument, PDFFont, PDFPage, rgb, type RGB } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { HEBREW_FONT_B64 } from './font-data';
import { shape } from './bidi';

/**
 * A small right-to-left-aware layout engine over pdf-lib.
 *
 * pdf-lib gives you "draw this glyph at this point" and nothing else — no text
 * flow, no tables, no page breaks, and no bidi. This wraps it in the handful of
 * primitives the firm's documents need, so the statement and invoice renderers
 * can describe *what* goes on the page instead of arithmetic.
 *
 * Every string passes through `shape()` on the way out, so Hebrew is reordered
 * for painting exactly once, here, and callers never think about it.
 */

// A4, in points.
export const PAGE_W = 595.28;
export const PAGE_H = 841.89;
export const MARGIN = 46;
export const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_SPACE = 54;

export const INK = rgb(0.086, 0.125, 0.184);
export const MUTED = rgb(0.42, 0.47, 0.54);
export const RULE = rgb(0.867, 0.89, 0.925);
export const ACCENT = rgb(0.549, 0.42, 0.247);
export const BAND = rgb(0.957, 0.969, 0.984);
export const GREEN = rgb(0.082, 0.478, 0.271);
export const RED = rgb(0.71, 0.22, 0.18);

export type Anchor = 'left' | 'right' | 'center';

export interface TextOpts {
  size?: number;
  bold?: boolean;
  color?: RGB;
  anchor?: Anchor;
  maxWidth?: number;
}

export interface Column {
  /** Header label. */
  label: string;
  /** Share of the content width, as a fraction of the total of all columns. */
  width: number;
  /** Numeric columns hug the far edge and use tabular spacing. */
  num?: boolean;
}

export interface Span {
  left: number;
  right: number;
  num: boolean;
}

export class Doc {
  private doc!: PDFDocument;
  private font!: PDFFont;
  private pages: PDFPage[] = [];
  page!: PDFPage;
  y = 0;
  readonly rtl: boolean;
  private footerNote = '';

  private constructor(rtl: boolean) {
    this.rtl = rtl;
  }

  static async create(opts: { rtl: boolean; footerNote?: string }): Promise<Doc> {
    const d = new Doc(opts.rtl);
    d.doc = await PDFDocument.create();
    d.doc.registerFontkit(fontkit);
    d.font = await d.doc.embedFont(Buffer.from(HEBREW_FONT_B64, 'base64'), { subset: true });
    d.footerNote = opts.footerNote ?? '';
    d.addPage();
    return d;
  }

  get pdf(): PDFDocument {
    return this.doc;
  }

  /** The edge text reads *from*: right in Hebrew, left in English. */
  get startX(): number {
    return this.rtl ? PAGE_W - MARGIN : MARGIN;
  }
  /** The edge text reads *towards*. */
  get endX(): number {
    return this.rtl ? MARGIN : PAGE_W - MARGIN;
  }
  private get startAnchor(): Anchor {
    return this.rtl ? 'right' : 'left';
  }
  private get endAnchor(): Anchor {
    return this.rtl ? 'left' : 'right';
  }

  addPage(): void {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.pages.push(this.page);
    this.y = PAGE_H - MARGIN;
  }

  /** Start a new page when `height` more points will not fit above the footer. */
  ensure(height: number): void {
    if (this.y - height < MARGIN + FOOTER_SPACE) this.addPage();
  }

  widthOf(text: string, size: number, bold = false): number {
    return this.font.widthOfTextAtSize(shape(text), size) + (bold ? 0.35 : 0);
  }

  /** Shorten text with an ellipsis until it fits `maxWidth`. */
  fit(text: string, size: number, maxWidth: number): string {
    if (this.widthOf(text, size) <= maxWidth) return text;
    let s = text;
    while (s.length > 1 && this.widthOf(s + '…', size) > maxWidth) s = s.slice(0, -1);
    return s + '…';
  }

  /**
   * Draw one line. `x` is interpreted according to `anchor`, so callers position
   * against whichever edge matters rather than computing widths themselves.
   */
  draw(text: string, x: number, y: number, opts: TextOpts = {}): void {
    const size = opts.size ?? 9.5;
    const bold = opts.bold ?? false;
    const body = opts.maxWidth ? this.fit(text, size, opts.maxWidth) : text;
    const shaped = shape(body);
    const w = this.font.widthOfTextAtSize(shaped, size);
    const anchor = opts.anchor ?? 'left';
    const drawX = anchor === 'right' ? x - w : anchor === 'center' ? x - w / 2 : x;
    const color = opts.color ?? INK;
    this.page.drawText(shaped, { x: drawX, y, size, font: this.font, color });
    // Faux bold: the variable font ships one weight, so overprint a hair to the side.
    if (bold) this.page.drawText(shaped, { x: drawX + 0.35, y, size, font: this.font, color });
  }

  /** Draw at the reading-start edge (right in Hebrew) and advance down. */
  line(text: string, opts: TextOpts & { gap?: number } = {}): void {
    const size = opts.size ?? 9.5;
    this.ensure(size + 4);
    this.draw(text, this.startX, this.y, { ...opts, anchor: opts.anchor ?? this.startAnchor, maxWidth: opts.maxWidth ?? CONTENT_W });
    this.y -= size + (opts.gap ?? 4);
  }

  /** Wrap a paragraph to the content width. */
  paragraph(text: string, opts: TextOpts & { lineGap?: number } = {}): void {
    const size = opts.size ?? 9.5;
    const maxWidth = opts.maxWidth ?? CONTENT_W;
    const words = String(text ?? '').split(/\s+/).filter(Boolean);
    let cur = '';
    const flush = () => {
      if (!cur) return;
      this.ensure(size + 4);
      this.draw(cur, this.startX, this.y, { ...opts, anchor: this.startAnchor });
      this.y -= size + (opts.lineGap ?? 3);
      cur = '';
    };
    for (const word of words) {
      const next = cur ? `${cur} ${word}` : word;
      if (this.widthOf(next, size) > maxWidth && cur) flush();
      else cur = next;
      if (!cur) cur = word;
    }
    flush();
  }

  rule(color: RGB = RULE, thickness = 0.75): void {
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_W - MARGIN, y: this.y },
      thickness,
      color,
    });
  }

  /** A section title with a short accent underline. */
  section(title: string): void {
    this.ensure(46);
    this.y -= 8;
    this.draw(title, this.startX, this.y, { size: 11.5, bold: true, anchor: this.startAnchor });
    this.y -= 6;
    const w = 34;
    const x0 = this.rtl ? this.startX - w : this.startX;
    this.page.drawLine({ start: { x: x0, y: this.y }, end: { x: x0 + w, y: this.y }, thickness: 1.6, color: ACCENT });
    this.y -= 12;
  }

  /**
   * Resolve column fractions into absolute spans, laid out from the reading-start
   * edge so the first column sits on the right in Hebrew.
   */
  spans(cols: Column[]): Span[] {
    const total = cols.reduce((s, c) => s + c.width, 0) || 1;
    const out: Span[] = [];
    let cursor = 0;
    for (const c of cols) {
      const w = (c.width / total) * CONTENT_W;
      const left = this.rtl ? PAGE_W - MARGIN - cursor - w : MARGIN + cursor;
      out.push({ left, right: left + w, num: !!c.num });
      cursor += w;
    }
    return out;
  }

  /** Place a cell inside its span: labels hug the reading start, numbers the far edge. */
  cell(text: string, span: Span, y: number, opts: TextOpts = {}): void {
    const pad = 4;
    const size = opts.size ?? 9;
    const width = span.right - span.left - pad * 2;
    if (span.num) {
      const x = this.rtl ? span.left + pad : span.right - pad;
      const anchor: Anchor = this.rtl ? 'left' : 'right';
      this.draw(text, x, y, { ...opts, size, anchor, maxWidth: width });
    } else {
      const x = this.rtl ? span.right - pad : span.left + pad;
      this.draw(text, x, y, { ...opts, size, anchor: this.startAnchor, maxWidth: width });
    }
  }

  /** Header band for a table. Returns the spans for the caller to fill rows with. */
  tableHeader(cols: Column[], opts: { size?: number } = {}): Span[] {
    const size = opts.size ?? 8.5;
    const spans = this.spans(cols);
    this.ensure(30);
    this.page.drawRectangle({ x: MARGIN, y: this.y - 7, width: CONTENT_W, height: 20, color: BAND });
    cols.forEach((c, i) => this.cell(c.label, spans[i]!, this.y, { size, bold: true, color: MUTED }));
    this.y -= 22;
    return spans;
  }

  /** One table row; pass `strong` for totals. */
  row(cells: string[], spans: Span[], opts: { size?: number; bold?: boolean; color?: RGB; rule?: boolean } = {}): void {
    const size = opts.size ?? 9;
    this.ensure(20);
    cells.forEach((text, i) => {
      const span = spans[i];
      if (span) this.cell(text, span, this.y, { size, bold: opts.bold, color: opts.color });
    });
    this.y -= 6;
    if (opts.rule !== false) this.rule();
    this.y -= 11;
  }

  /** A row of headline figures — the "fee / hours / total" band. */
  stats(items: { label: string; value: string; accent?: boolean }[]): void {
    const h = 46;
    this.ensure(h + 10);
    const gap = 8;
    const w = (CONTENT_W - gap * (items.length - 1)) / items.length;
    const top = this.y;
    items.forEach((item, i) => {
      const left = this.rtl
        ? PAGE_W - MARGIN - (i + 1) * w - i * gap
        : MARGIN + i * (w + gap);
      this.page.drawRectangle({
        x: left,
        y: top - h,
        width: w,
        height: h,
        color: item.accent ? rgb(0.976, 0.965, 0.945) : BAND,
        borderColor: item.accent ? ACCENT : RULE,
        borderWidth: item.accent ? 0.9 : 0.6,
      });
      const tx = this.rtl ? left + w - 10 : left + 10;
      const anchor = this.startAnchor;
      this.draw(item.label, tx, top - 17, { size: 7.8, color: MUTED, anchor, maxWidth: w - 20 });
      this.draw(item.value, tx, top - 36, { size: 14, bold: true, anchor, color: item.accent ? ACCENT : INK, maxWidth: w - 20 });
    });
    this.y = top - h - 14;
  }

  /** Embed a data: URI or raw PNG/JPEG logo, scaled to fit the given box. */
  async drawLogo(dataUrl: string, box: { x: number; y: number; maxW: number; maxH: number; anchor: Anchor }): Promise<number> {
    try {
      const m = /^data:(image\/[a-zA-Z+]+);base64,(.*)$/s.exec(dataUrl.trim());
      if (!m) return 0;
      const bytes = Buffer.from(m[2]!, 'base64');
      const img = m[1]!.includes('png') ? await this.doc.embedPng(bytes) : await this.doc.embedJpg(bytes);
      const scale = Math.min(box.maxW / img.width, box.maxH / img.height, 1);
      const w = img.width * scale;
      const h = img.height * scale;
      const x = box.anchor === 'right' ? box.x - w : box.anchor === 'center' ? box.x - w / 2 : box.x;
      this.page.drawImage(img, { x, y: box.y - h, width: w, height: h });
      return h;
    } catch {
      return 0; // A broken logo must never cost the client their document.
    }
  }

  /** Stamp "page n of m" on every page once the total is known. */
  private stampFooters(): void {
    const total = this.pages.length;
    this.pages.forEach((page, i) => {
      const saved = this.page;
      this.page = page;
      page.drawLine({
        start: { x: MARGIN, y: MARGIN + 24 },
        end: { x: PAGE_W - MARGIN, y: MARGIN + 24 },
        thickness: 0.6,
        color: RULE,
      });
      if (this.footerNote) {
        this.draw(this.footerNote, this.startX, MARGIN + 11, { size: 7.5, color: MUTED, anchor: this.startAnchor, maxWidth: CONTENT_W - 90 });
      }
      const label = this.rtl ? `${i + 1} / ${total}` : `${i + 1} / ${total}`;
      this.draw(label, this.endX, MARGIN + 11, { size: 7.5, color: MUTED, anchor: this.endAnchor });
      this.page = saved;
    });
  }

  async save(): Promise<Uint8Array> {
    this.stampFooters();
    return this.doc.save();
  }
}
