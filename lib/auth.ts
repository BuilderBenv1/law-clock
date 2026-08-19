import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';

/**
 * Google auth gated by an email allowlist with two sources:
 *   1. OWNER_EMAIL — comma-separated env var, always honoured (the bootstrap
 *      owner can never lock themselves out by emptying the table).
 *   2. app_users — rows the owner adds from Settings, so a colleague can be
 *      let in without touching Vercel or redeploying.
 * JWT sessions (no DB adapter needed).
 *
 * Required env: AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, OWNER_EMAIL.
 */
const envAllowed = (process.env.OWNER_EMAIL ?? '')
  .toLowerCase()
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

async function dbAllowed(email: string): Promise<boolean> {
  try {
    // Imported lazily: this module is also bundled into edge middleware, which
    // only ever runs the `authorized` callback and must not pull in the driver.
    const [{ getDb }, { appUsers }, { sql }] = await Promise.all([
      import('./db'),
      import('./db/schema'),
      import('drizzle-orm'),
    ]);
    const rows = await getDb()
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(sql`lower(${appUsers.email}) = ${email}`)
      .limit(1);
    return rows.length > 0;
  } catch (e) {
    console.error('app_users lookup failed', e);
    return false;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      authorization: { params: { prompt: 'select_account' } },
    }),
  ],
  pages: { signIn: '/login' },
  session: { strategy: 'jwt' },
  callbacks: {
    async signIn({ profile }) {
      if (envAllowed.length === 0) return true; // not configured -> allow (local/dev)
      const email = profile?.email?.toLowerCase().trim();
      if (!email) return false;
      if (envAllowed.includes(email)) return true;
      return dbAllowed(email);
    },
    authorized({ auth: session }) {
      return !!session?.user;
    },
  },
});
