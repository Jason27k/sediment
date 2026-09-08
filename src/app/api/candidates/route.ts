import { getSessionUser, unauthorized } from "@/lib/auth";
import { getProject, listCandidates } from "@/lib/projects";

/**
 * The capture tray, for anything reading it over HTTP.
 *
 * The tray in the app is server-rendered from listCandidates directly and does
 * not call this — a page that already queries the database has no reason to
 * make the browser ask a second time.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const slug = new URL(request.url).searchParams.get("project");
  if (!slug) return new Response("Missing project", { status: 400 });

  const project = await getProject(user.id, slug);
  if (!project) return new Response("Project not found", { status: 404 });

  return Response.json({ candidates: await listCandidates(project.id) });
}
