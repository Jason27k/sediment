import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local.");
}

export const sql = neon(process.env.DATABASE_URL);

/** pgvector accepts a bracketed literal; cast the parameter with ::vector at the call site. */
export function toVector(values: number[]): string {
  return `[${values.join(",")}]`;
}

/**
 * Awaits a Neon query and applies a row type.
 *
 * The driver returns Record<string, any>[]; casting the promise itself does not
 * typecheck, so anything used inside Promise.all goes through here.
 */
export async function rows<T>(query: PromiseLike<Record<string, unknown>[]>): Promise<T[]> {
  return (await query) as T[];
}
