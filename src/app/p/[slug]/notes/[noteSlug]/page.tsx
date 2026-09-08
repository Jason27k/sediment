import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { rows, sql } from "@/lib/db";
import { getNoteBySlug, getProject } from "@/lib/projects";
import { noteDependents } from "@/lib/notes";
import { NoteEditor } from "@/components/note-editor";

export const dynamic = "force-dynamic";

export default async function NotePage({
  params,
}: {
  params: Promise<{ slug: string; noteSlug: string }>;
}) {
  const { slug, noteSlug } = await params;
  const user = await requireUser();
  const project = await getProject(user.id, slug);
  if (!project) notFound();

  const note = await getNoteBySlug(project.id, noteSlug);
  if (!note) notFound();

  const [outbound, inbound, dependents] = await Promise.all([
    rows<{ slug: string; title: string }>(sql`
      select n.slug, n.title from note_links l
      join active_notes n on n.id = l.to_note
      where l.from_note = ${note.id}`),
    rows<{ slug: string; title: string }>(sql`
      select n.slug, n.title from note_links l
      join active_notes n on n.id = l.from_note
      where l.to_note = ${note.id}`),
    noteDependents(note.id),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between gap-4 border-b border-rule pb-3">
        <Link
          href={`/p/${project.slug}/notes`}
          className="font-mono text-xs text-accent hover:underline"
        >
          ← {project.name}
        </Link>
        <span className="font-mono text-[0.65rem] text-ink-faint">
          {note.kind}
          {note.assumes ? ` · assumes ${note.assumes}` : ""} · updated{" "}
          {new Date(note.updated_at).toISOString().slice(0, 10)}
        </span>
      </div>

      <NoteEditor
        note={{
          id: note.id,
          slug: note.slug,
          title: note.title,
          body_md: note.body_md,
          kind: note.kind,
          assumes: note.assumes,
        }}
        projectSlug={project.slug}
        dependents={dependents}
      />

      {(outbound.length > 0 || inbound.length > 0) && (
        <div className="grid gap-6 border-t border-rule pt-4 sm:grid-cols-2">
          {[
            { label: "Links to", items: outbound },
            { label: "Linked from", items: inbound },
          ]
            .filter((group) => group.items.length > 0)
            .map((group) => (
              <div key={group.label} className="flex flex-col gap-1">
                <h2 className="font-mono text-xs uppercase tracking-widest text-ink-faint">
                  {group.label}
                </h2>
                {group.items.map((item) => (
                  <Link
                    key={item.slug}
                    href={`/p/${project.slug}/notes/${item.slug}`}
                    className="text-sm text-accent hover:underline"
                  >
                    {item.title}
                  </Link>
                ))}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
