import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  const tables = await sql`
    select table_name, table_type
    from information_schema.tables
    where table_schema = 'public'
    order by table_type, table_name`;

  console.log("objects");
  for (const r of tables) {
    console.log(`  ${r.table_type === "VIEW" ? "view " : "table"}  ${r.table_name}`);
  }

  const indexes = await sql`
    select indexname from pg_indexes
    where schemaname = 'public'
      and (indexdef ilike '%hnsw%' or indexdef ilike '%gin%')
    order by indexname`;

  console.log("\nvector / fts indexes");
  for (const r of indexes) console.log(`  ${r.indexname}`);

  const ext = await sql`select extversion from pg_extension where extname = 'vector'`;
  const dims = await sql`
    select a.atttypmod as dims
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    where c.relname = 'notes' and a.attname = 'embedding'`;

  console.log(`\npgvector ${ext[0]?.extversion ?? "MISSING"} · notes.embedding dims ${dims[0]?.dims ?? "?"}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
