import { anthropic } from "@ai-sdk/anthropic";
import { streamText, type UIMessage } from "ai";
import { getSessionUser, unauthorized } from "@/lib/auth";
import { getBranch } from "@/lib/branches";
import { assembleContext } from "@/lib/context";
import { sql, toVector } from "@/lib/db";
import { classifyCandidate, wasDismissed } from "@/lib/dedupe";
import { embed } from "@/lib/embed";
import { extractCandidates } from "@/lib/extract";
import { getOrCreateMainConversation, getProject } from "@/lib/projects";
import { refreshSummary } from "@/lib/summary";

export const maxDuration = 60;

function lastUserText(messages: UIMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === "user");
  if (!last) return "";
  return last.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n")
    .trim();
}

/**
 * §06 steps 1–4. Runs after the assistant turn is persisted.
 *
 * Failures here are logged and swallowed: a capture problem must never cost the
 * user the conversation they just had.
 */
async function capture(
  userId: string,
  projectId: string,
  messageId: string,
  userTurn: string,
  assistantTurn: string,
): Promise<void> {
  try {
    const proposed = await extractCandidates(userTurn, assistantTurn);
    if (proposed.length === 0) return;

    const vectors = await embed(
      proposed.map((n) => `${n.title}\n\n${n.body_md}`),
      "document",
    );

    for (const [i, note] of proposed.entries()) {
      const vector = vectors[i];
      if (await wasDismissed(projectId, vector)) continue;

      const verdict = await classifyCandidate(projectId, vector);
      await sql`
        insert into note_candidates
          (user_id, project_id, message_id, title, body_md, kind, assumes,
           embedding, near_note_id, near_score, suggestion)
        values
          (${userId}, ${projectId}, ${messageId}, ${note.title}, ${note.body_md},
           ${note.kind}, ${note.assumes}, ${toVector(vector)}::vector,
           ${verdict.nearNoteId}, ${verdict.nearScore}, ${verdict.suggestion})`;
    }
  } catch (error) {
    console.error("capture failed", error);
  }
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const body = (await request.json()) as {
    messages: UIMessage[];
    projectSlug: string;
    conversationId?: string;
  };

  const project = await getProject(user.id, body.projectSlug);
  if (!project) return new Response("Project not found", { status: 404 });

  // A branch is just another conversation, so the turn machinery below is
  // identical; only the anchor it carries changes what context is assembled.
  const branch = body.conversationId ? await getBranch(user.id, body.conversationId) : null;
  if (body.conversationId && branch?.project_id !== project.id) {
    return new Response("Branch not found", { status: 404 });
  }

  const conversationId = branch?.id ?? (await getOrCreateMainConversation(user.id, project.id));
  const userTurn = lastUserText(body.messages);
  if (!userTurn) return new Response("Empty message", { status: 400 });

  // Context is assembled from the database, not from what the client sent, so a
  // long-running project stays at a fixed token budget (§08).
  const { system, history } = await assembleContext(project, conversationId, userTurn);

  await sql`
    insert into messages (conversation_id, role, content)
    values (${conversationId}, 'user', ${userTurn})`;

  const result = streamText({
    model: anthropic(process.env.ANTHROPIC_CHAT_MODEL ?? "claude-opus-5"),
    system,
    messages: [...history, { role: "user" as const, content: userTurn }],
    onFinish: async ({ text }) => {
      const [message] = (await sql`
        insert into messages (conversation_id, role, content, extracted_at)
        values (${conversationId}, 'assistant', ${text}, now())
        returning id`) as { id: string }[];

      // §06, the loop closes: a note-anchored branch amends the note it hangs
      // off rather than proposing a twelfth near-duplicate of it.
      if (!branch?.parent_note_id) {
        await capture(user.id, project.id, message.id, userTurn, text);
      }
      await refreshSummary(conversationId, project.id);
    },
  });

  return result.toUIMessageStreamResponse();
}
