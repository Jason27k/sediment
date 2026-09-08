import type { Note } from "./types";

function yamlString(value: string): string {
  return /^[\w.\-/ ]+$/.test(value) ? value : JSON.stringify(value);
}

/**
 * Serialises a note to the on-disk format from §05.
 *
 * Export exists so the corpus outlives the app: notes live in Postgres, but
 * they are markdown, and this is the function that proves it.
 */
export function noteToMarkdown(note: Note, links: string[]): string {
  const lines = [
    "---",
    `slug: ${note.slug}`,
    `title: ${yamlString(note.title)}`,
    `kind: ${note.kind}`,
    `assumes: ${note.assumes ? yamlString(note.assumes) : "null"}`,
  ];

  if (note.source_type) {
    lines.push("source:", `  type: ${note.source_type}`, `  ref: ${note.source_ref ?? ""}`);
  }

  lines.push(
    `created: ${note.created_at.toISOString().slice(0, 10)}`,
    `updated: ${note.updated_at.toISOString().slice(0, 10)}`,
    `links: [${links.join(", ")}]`,
    "---",
    "",
    note.body_md.trim(),
    "",
  );

  return lines.join("\n");
}
