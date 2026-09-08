import { marked } from "marked";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getBranch } from "@/lib/branches";
import { rows, sql } from "@/lib/db";
import { getProject, listCandidates } from "@/lib/projects";
import { BranchWorkspace, type BranchAnchorView } from "@/components/branch-workspace";
import type { Message, Note } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function BranchPage({
  params,
}: {
  params: Promise<{ slug: string; branchId: string }>;
}) {
  const { slug, branchId } = await params;
  const user = await requireUser();
  const project = await getProject(user.id, slug);
  if (!project) notFound();

  const branch = await getBranch(user.id, branchId);
  if (!branch || branch.project_id !== project.id) notFound();

  const [history, notes, candidates] = await Promise.all([
    rows<Message>(sql`
      select id, conversation_id, role, content, created_at
      from messages
      where conversation_id = ${branch.id} and role <> 'system'
      order by created_at`),
    branch.parent_note_id
      ? rows<Note>(sql`select * from active_notes where id = ${branch.parent_note_id}`)
      : Promise.resolve([]),
    // Only a message branch shows a tray, but the query is one indexed read and
    // fetching it here keeps the anchor cases from each needing their own await.
    listCandidates(project.id),
  ]);

  const note = notes[0] ?? null;

  // A note branch whose note has gone stays readable: the snapshot below is the
  // whole point of having written it at creation time.
  const anchor: BranchAnchorView = note
    ? { kind: "note", noteId: note.id, noteSlug: note.slug, noteTitle: note.title }
    : branch.parent_note_id
      ? { kind: "detached" }
      : { kind: "message" };

  const back = note
    ? { href: `/p/${project.slug}/notes/${note.slug}`, label: note.title }
    : { href: `/p/${project.slug}`, label: project.name };

  const snapshot = branch.anchor_snapshot_md ?? "";
  const drifted = note !== null && note.body_md.trim() !== snapshot.trim();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between gap-4 border-b border-rule pb-3">
        <Link href={back.href} className="font-mono text-xs text-accent hover:underline">
          ← {back.label}
        </Link>
        <span className="font-mono text-[0.65rem] text-ink-faint">
          branch · opened {new Date(branch.created_at).toISOString().slice(0, 10)}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">{branch.anchor_title ?? branch.title}</h1>
        {branch.parent_note_id && !note && (
          <p className="text-xs text-ink-soft">
            The note this hangs off has been deleted. What you worked out is still here.
          </p>
        )}
        {snapshot && (
          <details className="border border-rule bg-surface px-3 py-2">
            <summary className="cursor-pointer font-mono text-[0.65rem] uppercase tracking-widest text-ink-faint">
              {branch.parent_note_id ? "the note as it read when you branched" : "the message"}
              {drifted && " · since amended"}
            </summary>
            <div
              className="prose-note mt-2 max-w-none text-sm leading-relaxed"
              dangerouslySetInnerHTML={{ __html: marked.parse(snapshot) as string }}
            />
          </details>
        )}
      </div>

      <BranchWorkspace
        projectSlug={project.slug}
        conversationId={branch.id}
        initialMessages={history.map((m) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          parts: [{ type: "text" as const, text: m.content }],
        }))}
        anchor={anchor}
        candidates={candidates}
      />
    </div>
  );
}
