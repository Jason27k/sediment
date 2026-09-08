import { rows, sql } from "./db";
import { searchNotes } from "./search";
import type { Message, Project } from "./types";

/** §08. Fixed budget: a six-month project costs the same per turn as a six-minute one. */
export const RECENT_TURNS = 12;
export const RETRIEVED_NOTES = 6;

export type AssembledContext = {
  system: string;
  history: { role: "user" | "assistant"; content: string }[];
  retrieved: { slug: string; title: string }[];
};

/**
 * Builds the model's context fresh on every turn rather than appending to a
 * growing transcript. Older turns do not accumulate — they are replaced by the
 * notes they produced, which is the whole mechanism behind "the chat stays light".
 */
export async function assembleContext(
  project: Project,
  conversationId: string,
  userTurn: string,
): Promise<AssembledContext> {
  const [recent, hits, summaries] = await Promise.all([
    rows<Message>(sql`
      select id, conversation_id, role, content, created_at
      from messages
      where conversation_id = ${conversationId} and role <> 'system'
      order by created_at desc
      limit ${RECENT_TURNS}`),
    searchNotes(project.id, userTurn, RETRIEVED_NOTES),
    // Queried here rather than through summary.ts, which imports RECENT_TURNS
    // from this module and would otherwise close a cycle.
    rows<{ summary: string | null }>(sql`
      select summary from conversations where id = ${conversationId}`),
  ]);

  const summary = summaries[0]?.summary?.trim() ?? "";

  const history = recent
    .reverse()
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const neighbours = hits.length
    ? ((await sql`
        select distinct n.slug, n.title
        from note_links l
        join active_notes n on n.id = l.to_note
        where l.from_note = any(${hits.map((h) => h.id)})`) as { slug: string; title: string }[])
    : [];

  const notesBlock = hits.length
    ? hits.map((h) => `## ${h.title}  [[${h.slug}]]\n${h.body_md}`).join("\n\n")
    : "(no notes yet — this is a new project)";

  const neighbourBlock = neighbours.length
    ? `\n\nLinked but not shown in full: ${neighbours.map((n) => `[[${n.slug}]] ${n.title}`).join(", ")}`
    : "";

  const system = [
    "You are a tutor inside Sediment, a learning tool. The person you are talking to is",
    "building a durable note corpus out of these conversations, so favour explanations",
    "that would survive being written down as a single self-contained claim.",
    "",
    "Be concrete and technical. Prefer a worked example over a definition. When a",
    "distinction matters, say what breaks if you get it wrong. Do not summarise the",
    "conversation back; do not offer to help further.",
    "",
    "## What they are learning",
    project.brief?.trim() || `Project: ${project.name}. No brief written yet.`,
    "",
    // Only what the notes did not capture, covering the turns that have aged
    // out of the verbatim window (§08).
    ...(summary ? ["## Earlier in this conversation", summary, ""] : []),
    "## Notes already captured, retrieved for this turn",
    "These are their own notes. Build on them, refer to them by [[slug]], and say so",
    "plainly if something here is now wrong.",
    "",
    notesBlock + neighbourBlock,
  ].join("\n");

  return { system, history, retrieved: hits.map((h) => ({ slug: h.slug, title: h.title })) };
}
