import { getSessionUser, unauthorized } from "@/lib/auth";
import { mergeNotes } from "@/lib/notes";

/** Folds this note into another. A redirect, not a deletion (§07). */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await getSessionUser())) return unauthorized();
  const { id } = await ctx.params;
  const { targetNoteId } = (await request.json()) as { targetNoteId: string };

  try {
    await mergeNotes(id, targetNoteId);
    return Response.json({ ok: true });
  } catch (error) {
    return new Response((error as Error).message, { status: 400 });
  }
}
