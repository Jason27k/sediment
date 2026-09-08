import { getSessionUser, unauthorized } from "@/lib/auth";
import { sql } from "@/lib/db";
import { getProject } from "@/lib/projects";
import type { Candidate } from "@/lib/types";

/** The capture tray. Candidates are not notes and never appear in the corpus. */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const slug = new URL(request.url).searchParams.get("project");
  if (!slug) return new Response("Missing project", { status: 400 });

  const project = await getProject(user.id, slug);
  if (!project) return new Response("Project not found", { status: 404 });

  const candidates = (await sql`
    select c.*, n.title as near_title, n.slug as near_slug
    from note_candidates c
    left join notes n on n.id = c.near_note_id
    where c.project_id = ${project.id} and c.status = 'pending'
    order by c.created_at desc`) as (Candidate & {
    near_title: string | null;
    near_slug: string | null;
  })[];

  return Response.json({ candidates });
}
