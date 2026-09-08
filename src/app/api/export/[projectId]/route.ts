import JSZip from "jszip";
import { getSessionUser, unauthorized } from "@/lib/auth";
import { sql } from "@/lib/db";
import { noteToMarkdown } from "@/lib/markdown";
import type { Note, Project } from "@/lib/types";

/**
 * §03. The corpus outlives the app.
 *
 * Notes live in Postgres but they are markdown, and this is what proves it:
 * a zip of .md files with frontmatter, readable by Obsidian or anything else.
 */
export async function GET(request: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const { projectId } = await ctx.params;

  const [project] = (await sql`
    select * from projects where id = ${projectId} and user_id = ${user.id}`) as Project[];
  if (!project) return new Response("Not found", { status: 404 });

  const notes = (await sql`
    select * from active_notes where project_id = ${projectId} order by slug`) as Note[];

  const links = (await sql`
    select l.from_note, n.slug
    from note_links l
    join active_notes n on n.id = l.to_note
    where l.from_note = any(${notes.map((n) => n.id)})`) as {
    from_note: string;
    slug: string;
  }[];

  const bySource = new Map<string, string[]>();
  for (const link of links) {
    bySource.set(link.from_note, [...(bySource.get(link.from_note) ?? []), link.slug]);
  }

  const zip = new JSZip();
  const folder = zip.folder(project.slug)!;
  for (const note of notes) {
    folder.file(`${note.slug}.md`, noteToMarkdown(note, bySource.get(note.id) ?? []));
  }

  const archive = await zip.generateAsync({ type: "uint8array" });

  return new Response(archive as BodyInit, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${project.slug}.zip"`,
    },
  });
}
