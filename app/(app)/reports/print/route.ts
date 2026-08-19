import { auth } from '@/lib/auth';
import { buildReport } from '@/lib/queries';
import { getSettings, localeOf } from '@/lib/settings';
import { renderStatementHtml } from '@/lib/statement-doc';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Standalone, print-optimized report page. "Save as PDF" produces the doc. */
export async function GET(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return new Response('unauthorized', { status: 401 });

  const url = new URL(req.url);
  const clientId = url.searchParams.get('clientId') ?? '';
  const projectId = url.searchParams.get('projectId') || null;
  const from = Number(url.searchParams.get('from'));
  const to = Number(url.searchParams.get('to'));
  const allTime = url.searchParams.get('allTime') === '1';
  if (!clientId || !Number.isFinite(from) || !Number.isFinite(to)) {
    return new Response('bad request', { status: 400 });
  }

  const s = await getSettings();
  const report = await buildReport({ clientId, projectId, fromMs: from, toMs: to, allTime });
  if (!report) return new Response('not found', { status: 404 });

  const html = renderStatementHtml(report, s, localeOf(s), { standalone: true });
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
