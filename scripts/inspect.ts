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

  // §06 and §07's two open questions, which only a fortnight of real use answers.
  const [capture] = (await sql`
    select
      count(*) filter (where status = 'accepted')::int  as accepted,
      count(*) filter (where status = 'merged')::int     as merged,
      count(*) filter (where status = 'dismissed')::int  as dismissed,
      count(*) filter (where status = 'pending')::int    as pending
    from note_candidates`) as Record<string, number>[];

  const ruled = capture.accepted + capture.merged + capture.dismissed;
  console.log("\ncapture (§06)");
  console.log(`  accepted ${capture.accepted} · merged ${capture.merged} · dismissed ${capture.dismissed} · pending ${capture.pending}`);
  console.log(
    ruled === 0
      ? "  no accept rate yet — below roughly a third means the cadence is wrong, not the model"
      : `  accept rate ${Math.round(((capture.accepted + capture.merged) / ruled) * 100)}% of ${ruled} ruled on`,
  );

  const [amend] = (await sql`
    select
      count(*) filter (where status = 'applied')::int    as applied,
      count(*) filter (where status = 'discarded')::int  as discarded,
      count(*) filter (where status = 'superseded')::int as superseded,
      count(*) filter (where status = 'no_change')::int  as no_change,
      count(*) filter (where status = 'proposed')::int   as open,
      percentile_cont(0.5) within group (
        order by length(after_body_md)::float / nullif(length(before_body_md), 0)
      ) filter (where status = 'applied') as size_ratio
    from note_amendments`) as Record<string, number | null>[];

  const decided = Number(amend.applied) + Number(amend.discarded);
  console.log("\namendments (§07)");
  console.log(`  applied ${amend.applied} · discarded ${amend.discarded} · superseded ${amend.superseded} · confirmed the note ${amend.no_change} · open ${amend.open}`);
  console.log(
    decided === 0
      ? "  no apply rate yet"
      : `  apply rate ${Math.round((Number(amend.applied) / decided) * 100)}% of ${decided} ruled on`,
  );
  console.log(
    amend.size_ratio === null
      ? "  no size drift yet — an amended note should stay the size of a note"
      : `  median size after applying ${Math.round(Number(amend.size_ratio) * 100)}% of the note it replaced`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
