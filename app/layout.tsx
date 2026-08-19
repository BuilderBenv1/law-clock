import './globals.css';
import type { Metadata, Viewport } from 'next';
import { getSettings, localeOf } from '@/lib/settings';
import { dir } from '@/lib/i18n';

export const metadata: Metadata = {
  title: 'ניהול שעות ומשרד · Law Clock',
  description: 'מדידת זמן לפי לקוח, תיק ומשימה — עם דוחות בעברית.',
  appleWebApp: { capable: true, title: 'Law Clock', statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = {
  themeColor: '#0b1220',
  width: 'device-width',
  initialScale: 1,
};

/**
 * Bare document shell only. The firm-facing app chrome lives in the (app)
 * route group's layout; the client portal renders inside this shell directly,
 * so clients never see the firm's navigation.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const s = await getSettings().catch(() => null);
  const locale = s ? localeOf(s) : 'he';
  return (
    <html lang={locale} dir={dir(locale)}>
      <body>{children}</body>
    </html>
  );
}
