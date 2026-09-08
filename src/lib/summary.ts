import Anthropic from "@anthropic-ai/sdk";
import { RECENT_TURNS } from "./context";
import { rows, sql } from "./db";
import type { Message } from "./types";

const client = new Anthropic();

/** §08. Regenerated every 20 turns, and deliberately small. */
export const SUMMARY_EVERY = 20;
export const SUMMARY_MAX_TOKENS = 600;

const SYSTEM = `You maintain a running summary of a learning conversation.

The notes listed below are already captured permanently and are retrieved into
context on their own. Your summary must NOT restate them. It exists only to
carry the things a note could not hold:

- what the person is currently working on, and where they got stuck
- decisions they made and the reason, when the reason is not itself a note
- what they already said they know, so it is not re-explained
- threads left open — questions raised and not yet answered

Write 3-6 terse sentences of plain prose, no headings and no bullets. Prefer
dropping something over padding. If the older turns contained nothing the notes
did not already capture, say only what the person is working on.

Write in the third person about "they". This is scaffolding for a tutor, not a
document the person will read.`;

type ConversationSummary = { summary: string | null; summary_through_count: number };

/**
 * Rolls the summary forward when enough turns have aged out of the verbatim
 * window, and does nothing otherwise.
 *
 * Only messages that have fallen out of the last RECENT_TURNS are summarised —
 * anything still quoted verbatim would be said twice. Like capture, failures
 * are logged and swallowed: a summary problem must not cost the user their turn.
 */
export async function refreshSummary(conversationId: string, projectId: string): Promise<void> {
  try {
    const [[counts], [conversation]] = await Promise.all([
      rows<{ total: number }>(sql`
        select count(*)::int as total from messages
        where conversation_id = ${conversationId} and role <> 'system'`),
      rows<ConversationSummary>(sql`
        select summary, summary_through_count from conversations
        where id = ${conversationId}`),
    ]);

    const covered = conversation?.summary_through_count ?? 0;
    // Everything except the turns still being sent verbatim.
    const target = counts.total - RECENT_TURNS;
    if (target - covered < SUMMARY_EVERY) return;

    const aged = await rows<Message>(sql`
      select id, conversation_id, role, content, created_at
      from messages
      where conversation_id = ${conversationId} and role <> 'system'
      order by created_at
      offset ${covered}
      limit ${target - covered}`);
    if (aged.length === 0) return;

    const captured = await rows<{ title: string }>(sql`
      select title from active_notes where project_id = ${projectId} order by updated_at desc limit 60`);

    const transcript = aged
      .map((m) => `<${m.role}>\n${m.content}\n</${m.role}>`)
      .join("\n\n");

    const response = await client.messages.create({
      model: process.env.ANTHROPIC_EXTRACT_MODEL ?? "claude-haiku-4-5-20251001",
      max_tokens: SUMMARY_MAX_TOKENS,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            conversation?.summary
              ? `<summary_so_far>\n${conversation.summary}\n</summary_so_far>`
              : "<summary_so_far>(none yet)</summary_so_far>",
            `<notes_already_captured>\n${
              captured.map((n) => `- ${n.title}`).join("\n") || "(none)"
            }\n</notes_already_captured>`,
            `<older_turns>\n${transcript}\n</older_turns>`,
            "Rewrite the summary so it covers the older turns as well. Replace it entirely; do not append.",
          ].join("\n\n"),
        },
      ],
    });

    const text = response.content
      .filter((c): c is Anthropic.TextBlock => c.type === "text")
      .map((c) => c.text)
      .join("")
      .trim();
    if (!text) return;

    await sql`
      update conversations
      set summary = ${text}, summary_through_count = ${target}
      where id = ${conversationId}`;
  } catch (error) {
    console.error("summary refresh failed", error);
  }
}
