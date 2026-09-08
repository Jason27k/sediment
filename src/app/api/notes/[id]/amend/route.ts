import { getOpenProposal, proposeAmendment, recordProposal, resolveProposal } from "@/lib/amend";
import { getSessionUser, unauthorized } from "@/lib/auth";
import { getBranch } from "@/lib/branches";
import { rows, sql } from "@/lib/db";
import { diffLines, hasChanges } from "@/lib/diff";
import { updateNote } from "@/lib/notes";
import type { Message, Note } from "@/lib/types";

type Body =
  | { mode: "propose"; conversationId: string }
  | { mode: "apply"; amendmentId: string }
  | { mode: "discard"; amendmentId: string };

/**
 * §07. The three things that happen to an amendment.
 *
 * "propose" is a read: it reasons over the branch, records what it would change,
 * and returns a diff without touching the note. "apply" commits through
 * updateNote so the note re-embeds and reparses its [[links]] exactly as a hand
 * edit would. "discard" exists so that saying no is recorded rather than merely
 * not happening — without it the apply rate would only ever count its numerator.
 *
 * Applying takes an amendment id and not a body: what gets written is the text
 * that was proposed and shown, so the recorded row is exactly what landed.
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
    const open = await getOpenProposal(user.id, body.amendmentId, id);
    if (!open) return new Response("No open amendment for this note", { status: 404 });

    // The note first, then the record: a telemetry row left saying "proposed"
    // is a smaller harm than one claiming an edit that never landed.
    const updated = await updateNote(id, { title: open.after_title, body_md: open.after_body_md });
    await resolveProposal(user.id, open.id, "applied");

    return Response.json({ note: updated });
  }

  if (body.mode === "discard") {
    const discarded = await resolveProposal(user.id, body.amendmentId, "discarded");
    if (!discarded) return new Response("No open amendment for this note", { status: 404 });
    return Response.json({ ok: true });
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
  const changed = hasChanges(diff) || proposal.title !== note.title;
  const amendment = await recordProposal(user.id, note, branch.id, proposal, changed);

  return Response.json({
    amendmentId: amendment.id,
    proposal,
    diff,
    changed,
    titleChanged: proposal.title !== note.title,
  });
}
