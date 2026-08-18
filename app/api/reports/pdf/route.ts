import { auth } from '@/lib/auth';
import { buildReport } from '@/lib/queries';
import { getSettings, localeOf } from '@/lib/settings';
import { renderStatementPdf } from '@/lib/pdf/statement';
import { attachmentHeaders } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The hours statement as a downloadable PDF. */
export async function GET(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return new Response('unauthorized', { status: 401 });

  const url = new URL(req.url);
  const clientId = url.searchParams.get('clientId') ?? '';
  const projectId = url.searchParams.get('projectId') || null;
  const allTime = url.searchParams.get('allTime') === '1';
  const from = Number(url.searchParams.get('from'));
  const to = Number(url.searchParams.get('to'));
  if (!clientId || (!allTime && (!Number.isFinite(from) || !Number.isFinite(to)))) {
    return new Response('bad request', { status: 400 });
  }

  const s = await getSettings();
  const report = await buildReport({ clientId, projectId, fromMs: from || 0, toMs: to || Date.now(), allTime });
  if (!report) return new Response('not found', { status: 404 });

  const pdf = await renderStatementPdf(report, s, localeOf(s));
  const stamp = allTime ? 'all-time' : new Date(from).toISOString().slice(0, 10);
  return new Response(Buffer.from(pdf), {
    headers: attachmentHeaders('application/pdf', `statement-${report.client.name}-${stamp}.pdf`),
  });
}
