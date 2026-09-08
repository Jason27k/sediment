import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { messageBranches } from "@/lib/branches";
import { rows, sql } from "@/lib/db";
import { getOrCreateMainConversation, getProject, listCandidates } from "@/lib/projects";
import { Workspace } from "@/components/workspace";
import type { Message } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser();
  const project = await getProject(user.id, slug);
  if (!project) notFound();

  const conversationId = await getOrCreateMainConversation(user.id, project.id);
  const [history, branches, candidates] = await Promise.all([
    rows<Message>(sql`
      select id, conversation_id, role, content, created_at
      from messages
      where conversation_id = ${conversationId} and role <> 'system'
      order by created_at`),
    // Branches are listed under their anchor, never in a conversation list (§07).
    messageBranches(conversationId),
    listCandidates(project.id),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between gap-4 border-b border-rule pb-3">
        <div>
          <h1 className="text-xl font-semibold">{project.name}</h1>
          {project.brief && (
            <p className="mt-1 max-w-2xl text-sm text-ink-soft">{project.brief}</p>
          )}
        </div>
        <nav className="flex shrink-0 gap-4 font-mono text-xs">
          <Link href={`/p/${project.slug}/notes`} className="text-accent hover:underline">
            notes
          </Link>
          <a href={`/api/export/${project.id}`} className="text-ink-faint hover:text-accent">
            export
          </a>
        </nav>
      </div>

      <Workspace
        projectSlug={project.slug}
        branches={branches}
        candidates={candidates}
        initialMessages={history.map((m) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          parts: [{ type: "text" as const, text: m.content }],
        }))}
      />
    </div>
  );
}
