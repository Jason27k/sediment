import { getSessionUser, unauthorized } from "@/lib/auth";
import { sql } from "@/lib/db";
import { noteDependents, softDeleteNote, updateNote } from "@/lib/notes";
import type { Note } from "@/lib/types";

async function owned(userId: string, noteId: string): Promise<Note | null> {
  const [note] = (await sql`
    select * from notes where id = ${noteId} and user_id = ${userId}`) as Note[];
  return note ?? null;
}

/** Returns what a delete would take with it, for the confirmation in §07. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;
  if (!(await owned(user.id, id))) return new Response("Not found", { status: 404 });

  return Response.json({ dependents: await noteDependents(id) });
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;
  if (!(await owned(user.id, id))) return new Response("Not found", { status: 404 });

  const patch = (await request.json()) as {
    title?: string;
    body_md?: string;
    kind?: string;
    assumes?: string | null;
  };

  return Response.json({ note: await updateNote(id, patch) });
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;
  if (!(await owned(user.id, id))) return new Response("Not found", { status: 404 });

  await softDeleteNote(id);
  return Response.json({ ok: true });
}
