import Anthropic from "@anthropic-ai/sdk";
import { sql } from "./db";
import type { Amendment, AmendmentStatus, Message, Note } from "./types";

const client = new Anthropic();

/** The branch is the input; a long one is clipped from the front, keeping the resolution. */
const TRANSCRIPT_TURNS = 20;

export type AmendmentProposal = { title: string; body_md: string; rationale: string };

const TOOL: Anthropic.Tool = {
  name: "propose_amendment",
  description: "Rewrite the note so it says what the branch worked out. Often a small edit.",
  input_schema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description:
          "The note's title. Change it only if the claim itself changed; a clearer wording of the same claim is not a reason.",
      },
      body_md: {
        type: "string",
        description:
          "The complete rewritten body, not a patch and not an addendum. 2-6 sentences of markdown, the same register as the note you were given; include a code block only if the code IS the point. Return the body unchanged if the branch did not actually change what the note should say.",
      },
      rationale: {
        type: "string",
        description:
          "One sentence, addressed to the person: what the branch established and why the note needed it. If nothing changed, say what the branch confirmed instead.",
      },
    },
    required: ["title", "body_md", "rationale"],
  },
};

const SYSTEM = `You amend a single note after a conversation that resolved a confusion about it.

One note = one atomic claim. The amendment must not turn it into two. If the branch established a second, separable claim, leave it out — it will be captured on its own.

An amended note is still a note, and stays the size of one. If the fix will not fit in a handful of sentences, the note was two claims and you are only fixing the one it is about — the rest belongs in a note of its own. Amendments accumulate over a note's life, so each one has to leave it the same shape it found it.

Edit narrowly. The parts of the note that were not the problem stay as they are, word for word. You are fixing the step it skipped or the word it used loosely, not rewriting it in your own voice.

Never:
- append a "clarification" or "note:" paragraph to the end — fix the sentence that was wrong
- record that an amendment happened; the note is a claim, not a changelog
- add detail the branch did not establish
- restate the confusion; the note states what is true, not what confused them

If the branch resolved into "the note was already right", return the body byte-for-byte unchanged and say so in the rationale. That is a good outcome and reporting it honestly matters more than showing an edit.

Write in the person's voice, as something they would recognise as their own understanding.`;

/**
 * §07: the confusion resolves, and the resolution amends the note.
 *
 * This runs on the chat model rather than the cheap extraction model. It is
 * low-volume and it rewrites the durable artifact — the one place in the loop
 * where a sloppy edit costs more than the tokens saved.
 */
export async function proposeAmendment(
  note: Pick<Note, "title" | "body_md" | "kind" | "assumes">,
  turns: Message[],
): Promise<AmendmentProposal | null> {
  const recent = turns.slice(-TRANSCRIPT_TURNS);
  if (recent.length === 0) return null;

  const response = await client.messages.create({
    model: process.env.ANTHROPIC_CHAT_MODEL ?? "claude-opus-5",
    max_tokens: 2000,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: "tool", name: "propose_amendment" },
    messages: [
      {
        role: "user",
        content: [
          "<note>",
          `<title>${note.title}</title>`,
          `<kind>${note.kind}</kind>`,
          `<assumes>${note.assumes ?? "none"}</assumes>`,
          `<body>\n${note.body_md}\n</body>`,
          "</note>",
          "",
          "<branch>",
          recent.map((m) => `<${m.role}>\n${m.content}\n</${m.role}>`).join("\n\n"),
          "</branch>",
        ].join("\n"),
      },
    ],
  });

  const block = response.content.find((c) => c.type === "tool_use");
  if (!block || block.type !== "tool_use") return null;

  const input = block.input as Partial<AmendmentProposal>;
  if (!input.title?.trim() || !input.body_md?.trim()) return null;

  return {
    title: input.title.trim(),
    body_md: input.body_md.trim(),
    rationale: input.rationale?.trim() ?? "",
  };
}

/**
 * Records a proposal and what it would change, before anyone has ruled on it.
 *
 * An outstanding proposal for the same note in the same branch is marked
 * superseded rather than discarded: re-rolling is a weaker signal than reading
 * one and saying no, and folding the two together would understate the apply
 * rate exactly where it matters. A proposal that changes nothing is terminal on
 * arrival — the branch confirmed the note, and there is nothing left to rule on.
 */
export async function recordProposal(
  userId: string,
  note: Pick<Note, "id" | "title" | "body_md">,
  conversationId: string,
  proposal: AmendmentProposal,
  changed: boolean,
): Promise<Amendment> {
  await sql`
    update note_amendments
    set status = 'superseded', resolved_at = now()
    where note_id = ${note.id} and conversation_id = ${conversationId} and status = 'proposed'`;

  const [amendment] = (await sql`
    insert into note_amendments
      (user_id, note_id, conversation_id, before_title, before_body_md,
       after_title, after_body_md, rationale, status, resolved_at)
    values
      (${userId}, ${note.id}, ${conversationId}, ${note.title}, ${note.body_md},
       ${proposal.title}, ${proposal.body_md}, ${proposal.rationale},
       ${changed ? "proposed" : "no_change"}, ${changed ? null : new Date()})
    returning *`) as Amendment[];

  return amendment;
}

/** The open proposal for a note, if there is one. Scoped so a stale id cannot reach another note. */
export async function getOpenProposal(
  userId: string,
  amendmentId: string,
  noteId: string,
): Promise<Amendment | null> {
  const [amendment] = (await sql`
    select * from note_amendments
    where id = ${amendmentId} and user_id = ${userId} and note_id = ${noteId}
      and status = 'proposed'`) as Amendment[];

  return amendment ?? null;
}

/** Closes out a proposal. Only one that is still open can be ruled on. */
export async function resolveProposal(
  userId: string,
  amendmentId: string,
  status: Extract<AmendmentStatus, "applied" | "discarded">,
): Promise<Amendment | null> {
  const [amendment] = (await sql`
    update note_amendments
    set status = ${status}, resolved_at = now()
    where id = ${amendmentId} and user_id = ${userId} and status = 'proposed'
    returning *`) as Amendment[];

  return amendment ?? null;
}
