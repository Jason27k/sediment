import { getSessionUser, unauthorized } from "@/lib/auth";
import { createBranch } from "@/lib/branches";
import { sql } from "@/lib/db";

type Body = { noteId?: string; messageId?: string };

/**
 * §07. Opens an off-shoot conversation anchored to a note or a message.
 *
 * The anchor carries the project and the ownership check with it, so there is
 * nothing else to pass and nothing to get wrong: a branch cannot be opened onto
 * someone else's note, and it cannot land in a different project from its anchor.
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const { noteId, messageId } = (await request.json()) as Body;
  if (!noteId === !messageId) {
    return new Response("Provide exactly one of noteId or messageId", { status: 400 });
  }

  const branch = await createBranch(user.id, noteId ? { note: noteId } : { message: messageId! });
  if (!branch) return new Response("Anchor not found", { status: 404 });

  const [project] = (await sql`
    select slug from projects where id = ${branch.project_id}`) as { slug: string }[];

  return Response.json(
    { branch, url: `/p/${project.slug}/b/${branch.id}` },
    { status: 201 },
  );
}
