import Link from 'next/link';
import { auth, signOut } from '@/lib/auth';
import { getSettings, localeOf } from '@/lib/settings';
import { t } from '@/lib/i18n';

export async function Nav() {
  const session = await auth();
  const user = session?.user;
  const s = await getSettings().catch(() => null);
  const locale = s ? localeOf(s) : 'he';

  const links = [
    { href: '/', label: t(locale, 'dashboard') },
    { href: '/clients', label: t(locale, 'clients') },
    { href: '/invoices', label: t(locale, 'invoices') },
    { href: '/reports', label: t(locale, 'reports') },
    { href: '/settings', label: t(locale, 'settings') },
  ];

  return (
    <aside className="w-full md:w-56 shrink-0 border-b md:border-b-0 md:border-e border-slate-800 bg-panel/40 p-4 md:p-5 flex flex-row md:flex-col items-center md:items-stretch gap-3 md:gap-0">
      <div className="md:mb-8 shrink-0">
        <div className="text-base md:text-lg font-semibold leading-tight">{s?.firmName || t(locale, 'appName')}</div>
        <div className="text-xs text-slate-500 hidden md:block">{t(locale, 'tagline')}</div>
      </div>

      {user ? (
        <>
          {/* Horizontal scroll keeps every link one thumb-tap away on a phone. */}
          <nav className="flex md:flex-col gap-1 overflow-x-auto flex-1 md:flex-none">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-slate-800/60 whitespace-nowrap"
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="md:mt-auto md:pt-6 text-xs text-slate-500 shrink-0">
            <div className="truncate mb-2 hidden md:block">{user.email}</div>
            <form
              action={async () => {
                'use server';
                await signOut({ redirectTo: '/login' });
              }}
            >
              <button className="btn-ghost md:w-full" type="submit">
                {t(locale, 'signOut')}
              </button>
            </form>
          </div>
        </>
      ) : (
        <div className="text-xs text-slate-500">{t(locale, 'notSignedIn')}</div>
      )}
    </aside>
  );
}
