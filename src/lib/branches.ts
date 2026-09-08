import { rows, sql } from "./db";
import type { Conversation, Note } from "./types";

/** §07. Anything longer than this in a message anchor's title is cut at a word boundary. */
const ANCHOR_TITLE_CHARS = 70;

export type BranchAnchor = { note: string } | { message: string };

export type BranchSummary = {
  id: string;
  title: string | null;
  anchor_title: string | null;
  created_at: Date;
  turns: number;
};

function firstLine(text: string): string {
  const line = text.trim().split("\n").find((l) => l.trim()) ?? "";
  if (line.length <= ANCHOR_TITLE_CHARS) return line;
  const cut = line.slice(0, ANCHOR_TITLE_CHARS);
  return `${cut.slice(0, cut.lastIndexOf(" ") + 1 || cut.length).trim()}…`;
}

/**
 * Opens an off-shoot conversation.
 *
 * The snapshot is written here rather than at deletion time, which is the whole
 * argument in §07: a branch opened in March is about the March version of a note
 * since amended four times, so it has to carry the text it was actually asking
 * about. It also makes losing the anchor a non-event — there is no cleanup step,
 * because the conversation was self-contained from the moment it was created.
 */
export async function createBranch(
  userId: string,
  anchor: BranchAnchor,
): Promise<Conversation | null> {
  if ("note" in anchor) {
    const [note] = (await sql`
      select id, project_id, title, body_md from active_notes
      where id = ${anchor.note} and user_id = ${userId}`) as Pick<
      Note,
      "id" | "project_id" | "title" | "body_md"
    >[];
    if (!note) return null;

    const [branch] = (await sql`
      insert into conversations
        (user_id, project_id, title, parent_note_id, anchor_title, anchor_snapshot_md)
      values
        (${userId}, ${note.project_id}, ${note.title}, ${note.id}, ${note.title}, ${note.body_md})
      returning *`) as Conversation[];
    return branch;
  }

  // Ownership of a message runs through its conversation, which is also where
  // the project comes from — a branch always lives in the project it came from.
  const [message] = (await sql`
    select m.id, m.content, c.project_id
    from messages m
    join conversations c on c.id = m.conversation_id
    where m.id = ${anchor.message} and c.user_id = ${userId}`) as {
    id: string;
    content: string;
    project_id: string;
  }[];
  if (!message) return null;

  const title = firstLine(message.content);
  const [branch] = (await sql`
    insert into conversations
      (user_id, project_id, title, parent_message_id, anchor_title, anchor_snapshot_md)
    values
      (${userId}, ${message.project_id}, ${title}, ${message.id}, ${title}, ${message.content})
    returning *`) as Conversation[];
  return branch;
}

export async function getBranch(userId: string, id: string): Promise<Conversation | null> {
  const [branch] = (await sql`
    select * from conversations
    where id = ${id} and user_id = ${userId}
      and (parent_note_id is not null or parent_message_id is not null)`) as Conversation[];
  return branch ?? null;
}

/**
 * Branches are listed under their anchor, never in the main conversation list.
 * The count doubles as a difficulty signal — a note with four branches is one
 * you have repeatedly failed to understand — but §16 defers acting on that.
 */
export async function listBranches(noteId: string): Promise<BranchSummary[]> {
  return rows<BranchSummary>(sql`
    select c.id, c.title, c.anchor_title, c.created_at,
           (select count(*) from messages m
            where m.conversation_id = c.id and m.role <> 'system')::int as turns
    from conversations c
    where c.parent_note_id = ${noteId}
    order by c.created_at desc`);
}

/** Branch counts for every anchored message in one thread, for the affordance in the chat. */
export async function messageBranchCounts(conversationId: string): Promise<Map<string, number>> {
  const counts = await rows<{ parent_message_id: string; branches: number }>(sql`
    select b.parent_message_id, count(*)::int as branches
    from conversations b
    join messages m on m.id = b.parent_message_id
    where m.conversation_id = ${conversationId}
    group by b.parent_message_id`);

  return new Map(counts.map((row) => [row.parent_message_id, row.branches]));
}
