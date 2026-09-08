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

import { getOpenProposal, recordProposal, resolveProposal } from "../src/lib/amend";
import { createBranch, listBranches, messageBranches } from "../src/lib/branches";
import { sql, toVector } from "../src/lib/db";
import { diffLines, hasChanges } from "../src/lib/diff";
import { noteToMarkdown } from "../src/lib/markdown";
import { acceptCandidate, mergeNotes, noteDependents, softDeleteNote, syncLinks } from "../src/lib/notes";
import { parseLinks } from "../src/lib/links";
import { getOrCreateMainConversation } from "../src/lib/projects";
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

  const same = diffLines("One claim.\n\nWith a reason.", "One claim.\n\nWith a reason.\n");
  check("diff ignores trailing whitespace", !hasChanges(same));

  const reworded = diffLines("The trait is object safe.", "The trait is not object safe.");
  const inserted = reworded.find((r) => r.type === "add")?.parts?.filter((p) => p.changed);
  check("diff refines a reworded line to words", inserted?.length === 1 && inserted[0].text === "not ");

  const appended = diffLines("First.", "First.\nSecond.");
  check(
    "diff leaves a pure insertion unpaired",
    appended.length === 2 && appended[0].type === "same" && appended[1].type === "add",
  );

  // name is NOT NULL since 0002 mapped Better Auth onto this table.
  const [user] = (await sql`
    insert into users (email, name) values ('smoke@sediment.local', 'Smoke')
    on conflict (email) do update set name = excluded.name
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

  console.log("\nreview seeding (§06 step 5)");
  const candidate = async (title: string, kind: "concept" | "recipe") => {
    const [row] = (await sql`
      insert into note_candidates (user_id, project_id, title, body_md, kind)
      values (${user.id}, ${project.id}, ${title}, 'A body worth keeping.', ${kind})
      returning id`) as { id: string }[];
    return acceptCandidate(row.id, user.id);
  };

  const concept = await candidate("Vacuum only reclaims tuples no snapshot can see", "concept");
  const [seed] = (await sql`
    select rating, interval_d, ease, due_at from reviews where note_id = ${concept.id}`) as {
    rating: number | null;
    interval_d: string;
    ease: string;
    due_at: Date;
  }[];
  check("accepting a concept schedules it", seed !== undefined);
  check("the seed carries no rating", seed?.rating === null);
  check("it opens at SM-2's defaults", Number(seed?.interval_d) === 1 && Number(seed?.ease) === 2.5);
  check(
    "it is due in a day",
    Math.abs(new Date(seed.due_at).getTime() - (Date.now() + 86_400_000)) < 60_000,
    new Date(seed.due_at).toISOString(),
  );

  const recipe = await candidate("How to enable pg_stat_statements", "recipe");
  const recipeReviews = await sql`select id from reviews where note_id = ${recipe.id}`;
  check("recipes are not scheduled (§09)", recipeReviews.length === 0);
  // The delete confirmation names what it would take with it; a seed is not history.
  check("a seed does not count as review history", (await noteDependents(concept.id)).reviews === 0);

  console.log("\nbranches (§07)");
  const d = await mk("borrow-checker", "The borrow checker is a lifetime solver", "It proves no reference outlives its referent.", 4);
  const e = await mk("lifetime-elision", "Elision fills in the common lifetimes", "Three rules cover most signatures.", 5);

  const noteBranch = await createBranch(user.id, { note: d.id });
  check("branch anchors to a note", noteBranch?.parent_note_id === d.id && noteBranch?.project_id === project.id);
  check(
    "branch snapshots the note as it read",
    noteBranch?.anchor_snapshot_md === d.body_md && noteBranch?.anchor_title === d.title,
  );

  check("branch is not the main thread", (await getOrCreateMainConversation(user.id, project.id)) !== noteBranch!.id);

  const listed = await listBranches(d.id);
  check("branches list under their anchor", listed.length === 1 && listed[0].id === noteBranch!.id && listed[0].turns === 0);

  check("a branch cannot be opened on someone else's note", (await createBranch(crypto.randomUUID(), { note: d.id })) === null);

  const conversationId = await getOrCreateMainConversation(user.id, project.id);
  const [anchorMessage] = (await sql`
    insert into messages (conversation_id, role, content)
    values (${conversationId}, 'assistant', 'A lifetime is a region of the program, not a duration.')
    returning id`) as { id: string }[];

  const messageBranch = await createBranch(user.id, { message: anchorMessage.id });
  check(
    "branch anchors to a message and inherits its project",
    messageBranch?.parent_message_id === anchorMessage.id && messageBranch?.project_id === project.id,
  );
  check("message branch titles itself from the message", messageBranch?.anchor_title?.startsWith("A lifetime is a region") === true);

  const grouped = await messageBranches(conversationId);
  check("message branches group by anchor", grouped[anchorMessage.id]?.length === 1);

  console.log("\namendment telemetry (§07)");
  const proposal = { title: d.title, body_md: "It proves no reference outlives its referent, which is a region and not a duration.", rationale: "The branch pinned down what a lifetime is." };
  const first = await recordProposal(user.id, d, noteBranch!.id, proposal, true);
  check("a proposal is recorded before it is ruled on", first.status === "proposed" && first.resolved_at === null);
  check("it keeps the note as it read", first.before_body_md === d.body_md);

  check("the open proposal is findable", (await getOpenProposal(user.id, first.id, d.id))?.id === first.id);
  check("a stale id cannot reach another note", (await getOpenProposal(user.id, first.id, e.id)) === null);

  const second = await recordProposal(user.id, d, noteBranch!.id, proposal, true);
  const [superseded] = (await sql`select status from note_amendments where id = ${first.id}`) as { status: string }[];
  check("re-rolling supersedes rather than discards", superseded.status === "superseded");

  const applied = await resolveProposal(user.id, second.id, "applied");
  check("applying closes the proposal", applied?.status === "applied" && applied.resolved_at !== null);
  check("a proposal cannot be ruled on twice", (await resolveProposal(user.id, second.id, "discarded")) === null);

  const confirmed = await recordProposal(user.id, e, noteBranch!.id, { ...proposal, body_md: e.body_md }, false);
  check("a no-change proposal is terminal on arrival", confirmed.status === "no_change" && confirmed.resolved_at !== null);

  // §07: a merge is a redirect, so the reasoning follows the note it was about.
  await mergeNotes(d.id, e.id);
  const [reanchored] = (await sql`select parent_note_id from conversations where id = ${noteBranch!.id}`) as { parent_note_id: string }[];
  check("merging the anchor re-anchors the branch", reanchored.parent_note_id === e.id);

  // ...and a deletion is a non-event, because the snapshot was written up front.
  await softDeleteNote(e.id);
  const [orphan] = (await sql`select anchor_snapshot_md from conversations where id = ${noteBranch!.id}`) as { anchor_snapshot_md: string }[];
  check("deleting the anchor leaves the branch readable", orphan.anchor_snapshot_md === d.body_md);

  await sql`delete from projects where id = ${project.id}`;
  await sql`delete from users where id = ${user.id}`;
  console.log("\ncleaned up.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
