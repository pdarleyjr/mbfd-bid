import { type DrizzleD1Database, drizzle } from 'drizzle-orm/d1';
import * as schema from './schema.js';

export type DB = DrizzleD1Database<typeof schema>;
/** Returns a typed Drizzle client bound to the given D1 instance. */
export function getDb(d1: D1Database): DB {
  return drizzle(d1, { schema });
}
export { schema };
