/** Matches [[slug]] and [[slug|label]] in note bodies. */
const LINK = /\[\[([a-z0-9][a-z0-9-]*)(\|[^\]]*)?\]\]/gi;

export function parseLinks(bodyMd: string): string[] {
  const found = new Set<string>();
  for (const match of bodyMd.matchAll(LINK)) found.add(match[1].toLowerCase());
  return [...found];
}
