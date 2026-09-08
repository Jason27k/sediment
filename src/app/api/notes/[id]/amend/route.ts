import { proposeAmendment } from "@/lib/amend";
import { getSessionUser, unauthorized } from "@/lib/auth";
import { getBranch } from "@/lib/branches";
import { rows, sql } from "@/lib/db";
import { diffLines, hasChanges } from "@/lib/diff";
import { updateNote } from "@/lib/notes";
import type { Message, Note } from "@/lib/types";

type Body =
  | { mode: "propose"; conversationId: string }
  | { mode: "apply"; title: string; body_md: string };

/**
 * §07. The two halves of an amendment.
 *
 * "propose" is a read: it reasons over the branch and returns a diff, writing
 * nothing. "apply" is the commit, and it goes through updateNote so the note
 * re-embeds, reparses its [[links]] and bumps updated_at exactly as a hand edit
 * would. Splitting them is what puts the diff in front of the person before the
 * corpus changes — an amendment nobody read is just an unreviewed rewrite.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const { id } = await ctx.params;
  const [note] = (await sql`
    select * from active_notes where id = ${id} and user_id = ${user.id}`) as Note[];
  if (!note) return new Response("Note not found", { status: 404 });

  const body = (await request.json()) as Body;

  if (body.mode === "apply") {
    if (!body.body_md?.trim() || !body.title?.trim()) {
      return new Response("Amendment is empty", { status: 400 });
    }
    return Response.json({
      note: await updateNote(id, { title: body.title, body_md: body.body_md }),
    });
  }

  if (body.mode !== "propose") return new Response("Unknown mode", { status: 400 });

  const branch = await getBranch(user.id, body.conversationId);
  if (!branch || branch.parent_note_id !== id) {
    return new Response("Branch is not anchored to this note", { status: 404 });
  }

  const turns = await rows<Message>(sql`
    select id, conversation_id, role, content, created_at
    from messages
    where conversation_id = ${branch.id} and role <> 'system'
    order by created_at`);
  if (turns.length === 0) {
    return new Response("Nothing has been worked out in this branch yet", { status: 400 });
  }

  const proposal = await proposeAmendment(note, turns);
  if (!proposal) return new Response("No amendment could be proposed", { status: 502 });

  const diff = diffLines(note.body_md, proposal.body_md);

  return Response.json({
    proposal,
    diff,
    changed: hasChanges(diff) || proposal.title !== note.title,
    titleChanged: proposal.title !== note.title,
  });
}
