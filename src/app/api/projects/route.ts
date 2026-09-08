import { getSessionUser, unauthorized } from "@/lib/auth";
import { createProject } from "@/lib/projects";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const { name, brief } = (await request.json()) as { name: string; brief?: string };

  if (!name?.trim()) return new Response("Name is required", { status: 400 });

  const project = await createProject(user.id, name.trim(), brief?.trim() || null);
  return Response.json({ project });
}
