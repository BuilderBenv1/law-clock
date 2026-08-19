export { auth as middleware } from '@/lib/auth';

// Protect everything except auth routes, the cron endpoint, the login page,
// the client portal (token-secured), PWA assets, and static files.
export const config = {
  matcher: ['/((?!api/auth|api/cron|portal|manifest|icon|_next/static|_next/image|favicon.ico|login).*)'],
};
