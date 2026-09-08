import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getProject, listNotes } from "@/lib/projects";

export const dynamic = "force-dynamic";

export default async function NotesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser();
  const project = await getProject(user.id, slug);
  if (!project) notFound();

  const notes = await listNotes(project.id);
  const concepts = notes.filter((n) => n.kind === "concept");
  const recipes = notes.filter((n) => n.kind === "recipe");

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-baseline justify-between gap-4 border-b border-rule pb-3">
        <div>
          <h1 className="text-xl font-semibold">{project.name}</h1>
          <p className="mt-1 font-mono text-xs text-ink-faint">
            {concepts.length} concepts · {recipes.length} recipes
          </p>
        </div>
        <Link href={`/p/${project.slug}`} className="font-mono text-xs text-accent hover:underline">
          chat
        </Link>
      </div>

      {notes.length === 0 && (
        <p className="text-sm text-ink-faint">
          No notes yet. Have a conversation, then accept what is worth keeping.
        </p>
      )}

      {[
        { label: "Concepts", items: concepts, hint: "Durable. These enter review." },
        { label: "Recipes", items: recipes, hint: "How to do a specific thing. Findable, not memorised." },
      ]
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <section key={group.label} className="flex flex-col gap-2">
            <h2 className="font-mono text-xs uppercase tracking-widest text-ink-faint">
              {group.label} — {group.hint}
            </h2>
            <ul className="divide-y divide-rule border-y border-rule">
              {group.items.map((note) => (
                <li key={note.id}>
                  <Link
                    href={`/p/${project.slug}/notes/${note.slug}`}
                    className="flex items-baseline justify-between gap-4 py-2.5 hover:text-accent"
                  >
                    <span className="text-sm">{note.title}</span>
                    <span className="shrink-0 font-mono text-[0.65rem] text-ink-faint">
                      {note.assumes ?? ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
