import Anthropic from "@anthropic-ai/sdk";
import type { Message, Note } from "./types";

const client = new Anthropic();

/** The branch is the input; a long one is clipped from the front, keeping the resolution. */
const TRANSCRIPT_TURNS = 20;

export type Amendment = { title: string; body_md: string; rationale: string };

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
          "The complete rewritten body, not a patch and not an addendum. Return the body unchanged if the branch did not actually change what the note should say.",
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
): Promise<Amendment | null> {
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

  const input = block.input as Partial<Amendment>;
  if (!input.title?.trim() || !input.body_md?.trim()) return null;

  return {
    title: input.title.trim(),
    body_md: input.body_md.trim(),
    rationale: input.rationale?.trim() ?? "",
  };
}
