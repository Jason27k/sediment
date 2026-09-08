/**
 * Database and lifecycle checks. Run with: npm run smoke
 *
 * Voyage is stubbed at the fetch layer rather than behind a flag in embed.ts —
 * production code stays free of test hooks, and the stub still exercises the
 * real request/response handling. Set VOYAGE_API_KEY to hit the live API.
 */
const LIVE_VOYAGE = Boolean(process.env.VOYAGE_API_KEY);

if (!LIVE_VOYAGE) {
  process.env.VOYAGE_API_KEY = "stub";
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.includes("api.voyageai.com")) return realFetch(input, init);

    const body = JSON.parse(String(init?.body ?? "{}")) as { input?: string[] };
    const count = body.input?.length ?? 1;
    return new Response(
      JSON.stringify({
        data: Array.from({ length: count }, (_, index) => ({
          index,
          embedding: fakeVector(index + 1),
        })),
      }),
      { headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
}

import { sql, toVector } from "../src/lib/db";
import { noteToMarkdown } from "../src/lib/markdown";
import { mergeNotes, noteDependents, softDeleteNote, syncLinks } from "../src/lib/notes";
import { parseLinks } from "../src/lib/links";
import { slugify, uniqueSlug } from "../src/lib/slug";
import type { Note, Project, User } from "../src/lib/types";

/** Deterministic stand-in so DB paths can be exercised without calling Voyage. */
function fakeVector(seed: number): number[] {
  return Array.from({ length: 1024 }, (_, i) => Math.sin(seed * (i + 1)) * 0.05);
}

const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
};

async function main() {
  console.log("units");
  check("slugify", slugify("Last-write-wins with updated_at") === "last-write-wins-with-updated-at");
  check("uniqueSlug collides", uniqueSlug("a", new Set(["a", "a-2"])) === "a-3");
  check("parseLinks", JSON.stringify(parseLinks("see [[foo-bar]] and [[baz|Baz]]")) === '["foo-bar","baz"]');

  const [user] = (await sql`
    insert into users (email) values ('smoke@sediment.local')
    on conflict (email) do update set email = excluded.email
    returning id, email, name, image`) as User[];

  const [project] = (await sql`
    insert into projects (user_id, name, slug) values (${user.id}, 'Smoke', 'smoke-test')
    on conflict (user_id, slug) do update set name = excluded.name
    returning *`) as Project[];

  await sql`delete from notes where project_id = ${project.id}`;

  console.log("\ndatabase");
  const mk = async (slug: string, title: string, body: string, seed: number) => {
    const [n] = (await sql`
      insert into notes (user_id, project_id, slug, title, body_md, kind, assumes, embedding)
      values (${user.id}, ${project.id}, ${slug}, ${title}, ${body}, 'concept', 'Postgres 18',
              ${toVector(fakeVector(seed))}::vector)
      returning *`) as Note[];
    return n;
  };

  const a = await mk("last-write-wins", "Last-write-wins with updated_at", "Later timestamp wins. See [[crdt-tradeoffs]].", 1);
  const b = await mk("crdt-tradeoffs", "CRDTs keep every write", "Every write survives, at the cost of a merge algorithm.", 2);
  await syncLinks(a);

  const links = await sql`select to_note from note_links where from_note = ${a.id}`;
  check("[[links]] materialise", links.length === 1 && links[0].to_note === b.id);

  const near = (await sql`
    select slug, 1 - (embedding <=> ${toVector(fakeVector(1))}::vector) as score
    from active_notes where project_id = ${project.id}
    order by embedding <=> ${toVector(fakeVector(1))}::vector limit 1`) as { slug: string; score: number }[];
  check("vector search returns nearest", near[0]?.slug === "last-write-wins", `score ${Number(near[0]?.score).toFixed(3)}`);

  const fts = await sql`
    select slug from active_notes
    where project_id = ${project.id}
      and to_tsvector('english', title || ' ' || body_md) @@ websearch_to_tsquery('english', 'timestamp')`;
  check("full-text search matches", fts.length === 1 && fts[0].slug === "last-write-wins");

  const deps = await noteDependents(b.id);
  check("dependents counts inbound links", deps.inboundLinks === 1);

  const md = noteToMarkdown(a, ["crdt-tradeoffs"]);
  check("export frontmatter", md.startsWith("---\nslug: last-write-wins\n") && md.includes("links: [crdt-tradeoffs]"));

  console.log("\nlifecycle (§07)");
  const c = await mk("duplicate-idea", "A duplicate of the same idea", "Same claim, said twice.", 3);
  await mergeNotes(c.id, a.id);

  const live = await sql`select slug from active_notes where project_id = ${project.id} order by slug`;
  check("merged note leaves active_notes", !live.some((r) => r.slug === "duplicate-idea"));

  const [merged] = (await sql`select merged_into from notes where id = ${c.id}`) as { merged_into: string }[];
  check("merge sets a forward pointer", merged.merged_into === a.id);

  const [target] = (await sql`select body_md from notes where id = ${a.id}`) as { body_md: string }[];
  check("merge folds the body in", target.body_md.includes("Same claim, said twice."));

  await softDeleteNote(b.id);
  const afterDelete = await sql`select slug from active_notes where project_id = ${project.id}`;
  check("soft delete leaves active_notes", !afterDelete.some((r) => r.slug === "crdt-tradeoffs"));

  const stillThere = await sql`select deleted_at from notes where id = ${b.id}`;
  check("soft delete keeps the row", stillThere[0].deleted_at !== null);

  await sql`delete from projects where id = ${project.id}`;
  await sql`delete from users where id = ${user.id}`;
  console.log("\ncleaned up.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
