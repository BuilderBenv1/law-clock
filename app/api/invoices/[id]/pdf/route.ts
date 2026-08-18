import { auth } from '@/lib/auth';
import { getInvoiceDetail } from '@/lib/invoice-service';
import { renderInvoicePdfDoc } from '@/lib/pdf/invoice-pdf';
import { localeOf } from '@/lib/settings';
import { attachmentHeaders } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The invoice as a downloadable PDF. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await auth();
  if (!session?.user) return new Response('unauthorized', { status: 401 });

  const { id } = await params;
  const detail = await getInvoiceDetail(id);
  if (!detail) return new Response('not found', { status: 404 });

  const pdf = await renderInvoicePdfDoc(detail, localeOf(detail.settings));
  return new Response(Buffer.from(pdf), {
    headers: attachmentHeaders('application/pdf', `invoice-${detail.invoice.number}.pdf`),
  });
}
