import { Pool } from '@neondatabase/serverless';
import { drizzle, type NeonDatabase } from 'drizzle-orm/neon-serverless';
import * as schema from './schema';

let dbInstance: NeonDatabase<typeof schema> | null = null;

/**
 * Point the app at an already-built Drizzle instance.
 *
 * Used by `scripts/check-queries.mts`, which exercises the real query layer
 * against an in-process Postgres so the hand-written SQL is proven before it can
 * 500 a live page. Nothing in the application calls this.
 */
export function __setDbForTesting(db: unknown): void {
  dbInstance = db as NeonDatabase<typeof schema>;
}

/**
 * Lazily create the Drizzle client over Neon's serverless Pool (WebSocket) so
 * interactive transactions work. Reads DATABASE_URL at call time so the module
 * can be imported during build.
 */
export function getDb(): NeonDatabase<typeof schema> {
  if (dbInstance) return dbInstance;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const pool = new Pool({ connectionString: url });
  dbInstance = drizzle(pool, { schema });
  return dbInstance;
}

export { schema };
