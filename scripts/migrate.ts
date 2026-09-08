import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");

const sql = neon(url);

/**
 * Splits a migration into statements on semicolons that end a line.
 *
 * Line comments are stripped first, so a comment above a statement does not
 * get treated as part of it. Migrations here are plain DDL with no string
 * literals containing "--" and no dollar-quoted function bodies, which is what
 * makes this safe; revisit if a migration ever defines a function or trigger.
 */
function statements(source: string): string[] {
  return source
    .replace(/^\s*--.*$/gm, "")
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function main() {
  await sql`create table if not exists _migrations (
    name       text primary key,
    applied_at timestamptz not null default now()
  )`;

  const applied = new Set(
    (await sql`select name from _migrations`).map((r) => r.name as string),
  );

  const dir = join(process.cwd(), "migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  skip  ${file}`);
      continue;
    }
    const source = await readFile(join(dir, file), "utf8");
    for (const statement of statements(source)) {
      try {
        await sql.query(statement);
      } catch (error) {
        console.error(`\nFailed in ${file}:\n${statement.slice(0, 200)}\n`);
        throw error;
      }
    }
    await sql`insert into _migrations (name) values (${file})`;
    console.log(`  apply ${file}`);
    ran += 1;
  }

  console.log(ran === 0 ? "\nUp to date." : `\nApplied ${ran} migration(s).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
