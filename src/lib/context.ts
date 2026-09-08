import { rows, sql } from "./db";
import { searchNotes } from "./search";
import type { Conversation, Message, Note, Project } from "./types";

/** §08. Fixed budget: a six-month project costs the same per turn as a six-minute one. */
export const RECENT_TURNS = 12;
export const RETRIEVED_NOTES = 6;

/**
 * A branch spends part of the same budget on its anchor, so it retrieves fewer
 * notes and shows fewer neighbours. The anchor is the more valuable half — it is
 * the thing being asked about, not a guess at what might be related.
 */
export const BRANCH_RETRIEVED_NOTES = 3;
export const ANCHOR_NEIGHBOURS = 4;
/** §07: "the message and the ten turns around it". */
export const MESSAGE_ANCHOR_TURNS = 5;
/** Anchor excerpts are context, not the conversation; a long turn is clipped. */
const EXCERPT_CHARS = 800;

export type AssembledContext = {
  system: string;
  history: { role: "user" | "assistant"; content: string }[];
  retrieved: { slug: string; title: string }[];
};

function clip(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= EXCERPT_CHARS ? trimmed : `${trimmed.slice(0, EXCERPT_CHARS)}…`;
}

function transcript(messages: Message[]): string {
  return messages.map((m) => `<${m.role}>\n${clip(m.content)}\n</${m.role}>`).join("\n\n");
}

/**
 * The note a branch hangs off, its linked neighbours, and the exchange it was
 * extracted from (§07).
 *
 * The live note is preferred over the snapshot because the amendment applies to
 * the note as it stands now. The snapshot is what makes the branch survive the
 * note being merged away or deleted — that is the case it was written for.
 */
async function noteAnchor(branch: Conversation): Promise<string[]> {
  const [live] = (await sql`select * from notes where id = ${branch.parent_note_id}`) as Note[];
  const readable = live && !live.deleted_at && !live.merged_into;

  const title = readable ? live.title : (branch.anchor_title ?? "A note that no longer exists");
  const body = readable ? live.body_md : (branch.anchor_snapshot_md ?? "");

  const [neighbours, excerpt] = await Promise.all([
    readable
      ? rows<{ title: string; slug: string; body_md: string }>(sql`
          select distinct n.title, n.slug, n.body_md
          from note_links l
          join active_notes n
            on n.id = case when l.from_note = ${live.id} then l.to_note else l.from_note end
          where l.from_note = ${live.id} or l.to_note = ${live.id}
          limit ${ANCHOR_NEIGHBOURS}`)
      : Promise.resolve([]),
    readable && live.source_type === "message" && live.source_ref
      ? rows<Message>(sql`
          select id, conversation_id, role, content, created_at
          from messages
          where conversation_id = (select conversation_id from messages where id = ${live.source_ref})
            and created_at <= (select created_at from messages where id = ${live.source_ref})
            and role <> 'system'
          order by created_at desc
          limit 2`)
      : Promise.resolve([]),
  ]);

  return [
    "## The note they are asking about",
    readable
      ? "This is the note in its current form. It is what an amendment would change."
      : "This note has since been deleted or merged away. This is how it read when they asked.",
    "",
    `### ${title}`,
    body,
    ...(neighbours.length
      ? [
          "",
          "### Notes it links to",
          ...neighbours.map((n) => `#### ${n.title}  [[${n.slug}]]\n${n.body_md}`),
        ]
      : []),
    ...(excerpt.length
      ? ["", "### The exchange this note came from", transcript([...excerpt].reverse())]
      : []),
  ];
}

/** The anchored message and the turns around it (§07). */
async function messageAnchor(branch: Conversation): Promise<string[]> {
  const [target] = (await sql`
    select id, conversation_id, role, content, created_at
    from messages where id = ${branch.parent_message_id}`) as Message[];

  if (!target) {
    return [
      "## The message they are asking about",
      "The original message is gone; this is how it read when they asked.",
      "",
      branch.anchor_snapshot_md ?? "",
    ];
  }

  const [before, after] = await Promise.all([
    rows<Message>(sql`
      select id, conversation_id, role, content, created_at from messages
      where conversation_id = ${target.conversation_id} and role <> 'system'
        and created_at < ${target.created_at}
      order by created_at desc
      limit ${MESSAGE_ANCHOR_TURNS}`),
    rows<Message>(sql`
      select id, conversation_id, role, content, created_at from messages
      where conversation_id = ${target.conversation_id} and role <> 'system'
        and created_at > ${target.created_at}
      order by created_at
      limit ${MESSAGE_ANCHOR_TURNS}`),
  ]);

  return [
    "## The message they are asking about",
    `They pulled this out of the main thread. It is the <${target.role}> turn marked below.`,
    "",
    transcript([...before].reverse()),
    "",
    `>>> THE MESSAGE THEY ASKED ABOUT <<<\n${transcript([target])}`,
    ...(after.length ? ["", transcript(after)] : []),
  ];
}

function instructions(branch: Conversation | null): string[] {
  if (branch?.parent_note_id) {
    return [
      "You are a tutor inside Sediment, a learning tool. This is a branch conversation:",
      "the person is stuck on one specific note of theirs and pulled it out of the main",
      "thread to work it out. Stay on that note. When the confusion resolves, the note",
      "itself gets amended, so aim your explanation at what the note should have said.",
      "",
      "Do not restate the note back to them — they have read it, that is the problem.",
      "Find the step it skips or the word it uses loosely, and be concrete about that.",
    ];
  }

  if (branch?.parent_message_id) {
    return [
      "You are a tutor inside Sediment, a learning tool. This is a branch conversation:",
      "the person pulled one message out of the main thread to chase a tangent without",
      "derailing it. Answer the tangent on its own terms.",
      "",
      "Be concrete and technical. Prefer a worked example over a definition. Favour",
      "explanations that would survive being written down as a single self-contained claim.",
    ];
  }

  return [
    "You are a tutor inside Sediment, a learning tool. The person you are talking to is",
    "building a durable note corpus out of these conversations, so favour explanations",
    "that would survive being written down as a single self-contained claim.",
    "",
    "Be concrete and technical. Prefer a worked example over a definition. When a",
    "distinction matters, say what breaks if you get it wrong. Do not summarise the",
    "conversation back; do not offer to help further.",
  ];
}

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
  const [recent, allHits, conversations] = await Promise.all([
    rows<Message>(sql`
      select id, conversation_id, role, content, created_at
      from messages
      where conversation_id = ${conversationId} and role <> 'system'
      order by created_at desc
      limit ${RECENT_TURNS}`),
    searchNotes(project.id, userTurn, RETRIEVED_NOTES),
    // Queried here rather than through summary.ts, which imports RECENT_TURNS
    // from this module and would otherwise close a cycle.
    rows<Conversation>(sql`select * from conversations where id = ${conversationId}`),
  ]);

  const conversation = conversations[0] ?? null;
  const branch =
    conversation?.parent_note_id || conversation?.parent_message_id ? conversation : null;

  // The anchor note is already present in full; retrieving it again would spend
  // the budget twice on the same text.
  const hits = branch
    ? allHits.filter((h) => h.id !== branch.parent_note_id).slice(0, BRANCH_RETRIEVED_NOTES)
    : allHits;

  const anchor = branch
    ? branch.parent_note_id
      ? await noteAnchor(branch)
      : await messageAnchor(branch)
    : [];

  const summary = conversation?.summary?.trim() ?? "";

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
    ...instructions(branch),
    "",
    "## What they are learning",
    project.brief?.trim() || `Project: ${project.name}. No brief written yet.`,
    "",
    ...(anchor.length ? [...anchor, ""] : []),
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
