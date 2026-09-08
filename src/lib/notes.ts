import { sql, toVector } from "./db";
import { embedOne } from "./embed";
import { parseLinks } from "./links";
import { slugify, uniqueSlug } from "./slug";
import type { Note } from "./types";

function embedText(title: string, body: string): string {
  return `${title}\n\n${body}`;
}

/** Materialises [[slug]] references into note_links. Unresolved slugs stay dangling by design. */
export async function syncLinks(note: Pick<Note, "id" | "project_id" | "body_md">): Promise<void> {
  const slugs = parseLinks(note.body_md);
  await sql`delete from note_links where from_note = ${note.id}`;
  if (slugs.length === 0) return;

  await sql`
    insert into note_links (from_note, to_note)
    select ${note.id}, n.id
    from active_notes n
    where n.project_id = ${note.project_id} and n.slug = any(${slugs})
    on conflict do nothing`;
}

async function takenSlugs(projectId: string): Promise<Set<string>> {
  const rows = (await sql`select slug from notes where project_id = ${projectId}`) as {
    slug: string;
  }[];
  return new Set(rows.map((r) => r.slug));
}

/** §06 step 5. Commit a candidate as a new note. */
export async function acceptCandidate(candidateId: string, userId: string): Promise<Note> {
  const [candidate] = (await sql`
    select * from note_candidates where id = ${candidateId} and status = 'pending'`) as {
    id: string;
    project_id: string;
    title: string;
    body_md: string;
    kind: string;
    assumes: string | null;
    message_id: string | null;
  }[];

  if (!candidate) throw new Error("Candidate not found or already resolved.");

  const slug = uniqueSlug(slugify(candidate.title), await takenSlugs(candidate.project_id));
  const vector = toVector(await embedOne(embedText(candidate.title, candidate.body_md), "document"));

  const [note] = (await sql`
    insert into notes (user_id, project_id, slug, title, body_md, kind, assumes,
                       source_type, source_ref, embedding)
    values (${userId}, ${candidate.project_id}, ${slug}, ${candidate.title}, ${candidate.body_md},
            ${candidate.kind}, ${candidate.assumes},
            ${candidate.message_id ? "message" : null}, ${candidate.message_id},
            ${vector}::vector)
    returning *`) as Note[];

  await syncLinks(note);
  await sql`
    update note_candidates set status = 'accepted', resolved_at = now() where id = ${candidateId}`;

  return note;
}

/** §06 step 3, the "extend" path: fold a candidate into the note it duplicates. */
export async function extendWithCandidate(
  candidateId: string,
  targetNoteId: string,
): Promise<Note> {
  const [candidate] = (await sql`
    select * from note_candidates where id = ${candidateId} and status = 'pending'`) as {
    body_md: string;
  }[];
  const [target] = (await sql`select * from active_notes where id = ${targetNoteId}`) as Note[];

  if (!candidate) throw new Error("Candidate not found or already resolved.");
  if (!target) throw new Error("Target note not found.");

  const merged = `${target.body_md.trim()}\n\n${candidate.body_md.trim()}\n`;
  const note = await updateNote(targetNoteId, { body_md: merged });

  await sql`
    update note_candidates
    set status = 'merged', resolved_at = now(), near_note_id = ${targetNoteId}
    where id = ${candidateId}`;

  return note;
}

export async function dismissCandidate(candidateId: string): Promise<void> {
  await sql`
    update note_candidates
    set status = 'dismissed', resolved_at = now()
    where id = ${candidateId} and status = 'pending'`;
}

export async function updateNote(
  noteId: string,
  patch: { title?: string; body_md?: string; kind?: string; assumes?: string | null },
): Promise<Note> {
  const [current] = (await sql`select * from notes where id = ${noteId}`) as Note[];
  if (!current) throw new Error("Note not found.");

  const title = patch.title ?? current.title;
  const body = patch.body_md ?? current.body_md;
  const kind = patch.kind ?? current.kind;
  const assumes = patch.assumes === undefined ? current.assumes : patch.assumes;

  // Re-embed only when the embedded text actually changed; a kind or assumes
  // edit does not need a Voyage round trip.
  const reembed = title !== current.title || body !== current.body_md;

  const [note] = reembed
    ? ((await sql`
        update notes set
          title = ${title}, body_md = ${body}, kind = ${kind}, assumes = ${assumes},
          embedding = ${toVector(await embedOne(embedText(title, body), "document"))}::vector,
          updated_at = now()
        where id = ${noteId}
        returning *`) as Note[])
    : ((await sql`
        update notes set
          title = ${title}, body_md = ${body}, kind = ${kind}, assumes = ${assumes},
          updated_at = now()
        where id = ${noteId}
        returning *`) as Note[]);

  await syncLinks(note);
  return note;
}

/**
 * §07. A merge is a redirect, not a deletion: the row stays, carries a pointer
 * to its successor, and drops out of active_notes. Branches re-anchor to the
 * target so the reasoning they hold survives.
 */
export async function mergeNotes(sourceId: string, targetId: string): Promise<void> {
  if (sourceId === targetId) throw new Error("Cannot merge a note into itself.");

  const [source] = (await sql`select * from active_notes where id = ${sourceId}`) as Note[];
  const [target] = (await sql`select * from active_notes where id = ${targetId}`) as Note[];
  if (!source || !target) throw new Error("Both notes must exist and be live.");

  await updateNote(targetId, {
    body_md: `${target.body_md.trim()}\n\n${source.body_md.trim()}\n`,
  });

  await sql`update conversations set parent_note_id = ${targetId} where parent_note_id = ${sourceId}`;
  await sql`update notes set merged_into = ${targetId}, updated_at = now() where id = ${sourceId}`;
  await sql`delete from note_links where from_note = ${sourceId} or to_note = ${sourceId}`;
}

/** What a delete would take with it — shown in the confirmation, per §07. */
export async function noteDependents(noteId: string) {
  const [row] = (await sql`
    select
      (select count(*) from note_links where to_note = ${noteId})            as inbound_links,
      (select count(*) from conversations where parent_note_id = ${noteId})  as branches,
      (select count(*) from reviews where note_id = ${noteId})               as reviews`) as {
    inbound_links: string;
    branches: string;
    reviews: string;
  }[];

  return {
    inboundLinks: Number(row.inbound_links),
    branches: Number(row.branches),
    reviews: Number(row.reviews),
  };
}

/** Soft delete with a 30-day window. Branches keep their anchor snapshot (§07). */
export async function softDeleteNote(noteId: string): Promise<void> {
  await sql`update notes set deleted_at = now(), updated_at = now() where id = ${noteId}`;
  await sql`delete from note_links where from_note = ${noteId} or to_note = ${noteId}`;
}
