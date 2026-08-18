'use client';

import { useState } from 'react';

/**
 * Turns a rendered element into a downloaded A4 PDF.
 *
 * The page is rasterised with html2canvas and placed into a jsPDF document,
 * slicing it across pages when it is taller than one sheet. Going through the
 * browser's own rendering is what keeps Hebrew RTL text laid out correctly —
 * PDF text engines need font embedding plus bidi handling to get this right,
 * and still tend to mangle mixed Hebrew/Latin lines. The trade-off is that the
 * text is an image rather than selectable, which is the usual expectation for
 * an issued statement anyway.
 */
export function DownloadPdfButton({
  targetId,
  filename,
  label,
  className = 'btn-primary',
}: {
  targetId: string;
  filename: string;
  label: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function download() {
    const el = document.getElementById(targetId);
    if (!el) {
      setError('not found');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);

      const canvas = await html2canvas(el, {
        scale: 2, // retina-ish, so small print stays legible
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
      });

      const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 8;
      const usableW = pageW - margin * 2;
      const usableH = pageH - margin * 2;

      // How many source pixels correspond to one page of usable height.
      const pxPerPage = Math.floor((canvas.width / usableW) * usableH);
      const pages = Math.max(1, Math.ceil(canvas.height / pxPerPage));

      for (let p = 0; p < pages; p++) {
        const sliceH = Math.min(pxPerPage, canvas.height - p * pxPerPage);
        const slice = document.createElement('canvas');
        slice.width = canvas.width;
        slice.height = sliceH;
        const ctx = slice.getContext('2d');
        if (!ctx) throw new Error('canvas unavailable');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, slice.width, slice.height);
        ctx.drawImage(canvas, 0, p * pxPerPage, canvas.width, sliceH, 0, 0, canvas.width, sliceH);

        const imgH = (sliceH / canvas.width) * usableW;
        if (p > 0) pdf.addPage();
        pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, usableW, imgH);
      }

      pdf.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className={className} onClick={download} disabled={busy}>
        {busy ? '…' : `⭳ ${label}`}
      </button>
      {error ? <span className="text-xs text-red-400">{error}</span> : null}
    </span>
  );
}
