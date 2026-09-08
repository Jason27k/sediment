/**
 * §07. The amendment diff.
 *
 * A note body is a handful of paragraphs, so a line diff on its own is too
 * coarse to read: rewording six words inside a paragraph shows up as the whole
 * paragraph deleted and re-added. Changed lines are therefore refined a second
 * time at word level, which is what makes "what did the branch actually change"
 * answerable at a glance. Bodies are small enough that the quadratic LCS never
 * matters; the caps below exist only so a pasted transcript cannot stall a
 * request.
 */

export type WordPart = { text: string; changed: boolean };
export type DiffRow = { type: "same" | "add" | "del"; text: string; parts?: WordPart[] };

/** Beyond this many tokens on either side, a changed line is left un-refined. */
const REFINE_LIMIT = 400;

/** Longest common subsequence table, filled from the end so `walk` can read it forwards. */
function table(a: string[], b: string[]): number[][] {
  const grid = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      grid[i][j] =
        a[i] === b[j] ? grid[i + 1][j + 1] + 1 : Math.max(grid[i + 1][j], grid[i][j + 1]);
    }
  }
  return grid;
}

function walk(a: string[], b: string[]): DiffRow[] {
  const grid = table(a, b);
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      rows.push({ type: "same", text: a[i] });
      i++;
      j++;
    } else if (grid[i + 1][j] >= grid[i][j + 1]) {
      rows.push({ type: "del", text: a[i] });
      i++;
    } else {
      rows.push({ type: "add", text: b[j] });
      j++;
    }
  }
  while (i < a.length) rows.push({ type: "del", text: a[i++] });
  while (j < b.length) rows.push({ type: "add", text: b[j++] });

  return rows;
}

/** Words and the whitespace between them, so parts can be concatenated back into the line. */
function words(line: string): string[] {
  return line.split(/(\s+)/).filter((token) => token !== "");
}

function append(parts: WordPart[], text: string, changed: boolean): void {
  const last = parts[parts.length - 1];
  if (last && last.changed === changed) last.text += text;
  else parts.push({ text, changed });
}

function wordParts(before: string, after: string): [WordPart[], WordPart[]] {
  const a = words(before);
  const b = words(after);
  if (a.length > REFINE_LIMIT || b.length > REFINE_LIMIT) return [[], []];

  const beforeParts: WordPart[] = [];
  const afterParts: WordPart[] = [];

  for (const row of walk(a, b)) {
    if (row.type === "same") {
      append(beforeParts, row.text, false);
      append(afterParts, row.text, false);
    } else if (row.type === "del") {
      append(beforeParts, row.text, true);
    } else {
      append(afterParts, row.text, true);
    }
  }

  return [beforeParts, afterParts];
}

/**
 * Pairs each run of deletions with the additions that replaced it and marks the
 * words that actually moved. Runs of unequal length are a real insertion or
 * removal rather than a rewrite, so they are left alone — inventing a pairing
 * there would highlight words that were never edited.
 */
function refine(rows: DiffRow[]): DiffRow[] {
  const out: DiffRow[] = [];

  for (let i = 0; i < rows.length; ) {
    if (rows[i].type === "same") {
      out.push(rows[i++]);
      continue;
    }

    let end = i;
    while (end < rows.length && rows[end].type === "del") end++;
    const dels = rows.slice(i, end);

    let addEnd = end;
    while (addEnd < rows.length && rows[addEnd].type === "add") addEnd++;
    const adds = rows.slice(end, addEnd);

    if (dels.length > 0 && dels.length === adds.length) {
      const pairs = dels.map((del, k) => wordParts(del.text, adds[k].text));
      dels.forEach((del, k) => out.push({ ...del, parts: pairs[k][0] }));
      adds.forEach((add, k) => out.push({ ...add, parts: pairs[k][1] }));
    } else {
      out.push(...dels, ...adds);
    }

    i = addEnd;
  }

  return out;
}

/** Trailing whitespace is invisible in the rendered note, so it must not read as a change. */
function lines(text: string): string[] {
  return text.replace(/\s+$/, "").split("\n").map((line) => line.replace(/\s+$/, ""));
}

export function diffLines(before: string, after: string): DiffRow[] {
  return refine(walk(lines(before), lines(after)));
}

export function hasChanges(rows: DiffRow[]): boolean {
  return rows.some((row) => row.type !== "same");
}
