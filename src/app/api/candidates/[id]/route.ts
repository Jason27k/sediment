import { getSessionUser, unauthorized } from "@/lib/auth";
import { acceptCandidate, dismissCandidate, extendWithCandidate } from "@/lib/notes";

type Body =
  | { action: "accept" }
  | { action: "dismiss" }
  | { action: "extend"; targetNoteId: string };

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;
  const body = (await request.json()) as Body;

  try {
    switch (body.action) {
      case "accept":
        return Response.json({ note: await acceptCandidate(id, user.id) });
      case "extend":
        return Response.json({ note: await extendWithCandidate(id, body.targetNoteId) });
      case "dismiss":
        await dismissCandidate(id);
        return Response.json({ ok: true });
      default:
        return new Response("Unknown action", { status: 400 });
    }
  } catch (error) {
    return new Response((error as Error).message, { status: 400 });
  }
}
