import Anthropic from "@anthropic-ai/sdk";
import type { NoteKind } from "./types";

const client = new Anthropic();

export type ProposedNote = {
  title: string;
  body_md: string;
  kind: NoteKind;
  assumes: string | null;
};

const TOOL: Anthropic.Tool = {
  name: "propose_notes",
  description: "Record the atomic notes worth keeping from this exchange. Usually zero.",
  input_schema: {
    type: "object",
    properties: {
      notes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "The claim itself, as a short statement. Not a topic label.",
            },
            body_md: {
              type: "string",
              description:
                "2-6 sentences of markdown stating the claim and why it holds. Include a code block only if the code IS the point.",
            },
            kind: {
              type: "string",
              enum: ["concept", "recipe"],
              description:
                "concept: durable understanding, worth recalling later. recipe: how to do a specific thing with a specific tool, which will decay and be looked up rather than recalled.",
            },
            assumes: {
              type: ["string", "null"],
              description:
                "Version or date this depends on, e.g. 'Next.js 16' or '2026-09'. Null if the claim is version-independent.",
            },
          },
          required: ["title", "body_md", "kind", "assumes"],
        },
      },
    },
    required: ["notes"],
  },
};

const SYSTEM = `You extract durable notes from a learning conversation.

One note = one atomic claim. If you cannot state it in a single sentence title, it is two notes or it is not a note.

Propose NOTHING unless the exchange actually taught something. Most turns are navigation, clarification, or pleasantries and should yield an empty list. An empty list is the common and correct answer — you are not being helpful by finding something.

Never propose a note for:
- restatements of what the user already said they knew
- the assistant's meta-commentary about the conversation
- anything you cannot state without referring to "this" or "the above"

Write in the user's voice, as something they would recognise as their own understanding.`;

/** §06 step 1. Runs on the cheap model: high-volume and structurally simple. */
export async function extractCandidates(
  userTurn: string,
  assistantTurn: string,
): Promise<ProposedNote[]> {
  const response = await client.messages.create({
    model: process.env.ANTHROPIC_EXTRACT_MODEL ?? "claude-haiku-4-5-20251001",
    max_tokens: 2000,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: "tool", name: "propose_notes" },
    messages: [
      {
        role: "user",
        content: `<exchange>\n<question>\n${userTurn}\n</question>\n<answer>\n${assistantTurn}\n</answer>\n</exchange>`,
      },
    ],
  });

  const block = response.content.find((c) => c.type === "tool_use");
  if (!block || block.type !== "tool_use") return [];

  const input = block.input as { notes?: ProposedNote[] };
  return (input.notes ?? []).filter((n) => n.title?.trim() && n.body_md?.trim());
}
