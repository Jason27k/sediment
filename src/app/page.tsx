import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listProjects } from "@/lib/projects";
import { NewProject } from "@/components/new-project";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireUser();
  const projects = await listProjects(user.id);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Projects</h1>
        <p className="mt-1 text-sm text-ink-soft">
          One subject each. Notes, conversations, and review are scoped to a project.
        </p>
      </div>

      {projects.length === 0 ? (
        <p className="text-sm text-ink-faint">
          No projects yet. The first one should be the thing you are actually trying to learn.
        </p>
      ) : (
        <ul className="divide-y divide-rule border-y border-rule">
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                href={`/p/${project.slug}`}
                className="flex items-baseline justify-between gap-4 py-3 hover:text-accent"
              >
                <span className="font-medium">{project.name}</span>
                <span className="font-mono text-xs text-ink-faint">
                  {project.note_count} {project.note_count === 1 ? "note" : "notes"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <NewProject />
    </div>
  );
}
