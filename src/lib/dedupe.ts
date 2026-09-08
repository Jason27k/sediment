import { sql, toVector } from "./db";
import type { Suggestion } from "./types";

/**
 * §06 step 3. Thresholds are the most important numbers in the product and are
 * meant to be tuned against a real corpus — code embeddings cluster tighter
 * than general ones, so expect these to move up after the first fifty notes.
 */
export const EXTEND_THRESHOLD = Number(process.env.DEDUPE_EXTEND ?? 0.86);
export const REVIEW_THRESHOLD = Number(process.env.DEDUPE_REVIEW ?? 0.78);

export type DedupeVerdict = {
  suggestion: Suggestion;
  nearNoteId: string | null;
  nearScore: number | null;
};

/**
 * Compares a candidate against the live corpus and says what to do with it.
 *
 * Above EXTEND_THRESHOLD the candidate is an amendment to an existing note, not
 * a new one. Between the thresholds it is offered as new with its nearest
 * neighbour shown alongside so a merge is one click away.
 */
export async function classifyCandidate(
  projectId: string,
  embedding: number[],
): Promise<DedupeVerdict> {
  const vector = toVector(embedding);

  const rows = (await sql`
    select id, 1 - (embedding <=> ${vector}::vector) as score
    from active_notes
    where project_id = ${projectId} and embedding is not null
    order by embedding <=> ${vector}::vector
    limit 1`) as { id: string; score: number }[];

  const nearest = rows[0];
  if (!nearest) return { suggestion: "new", nearNoteId: null, nearScore: null };

  const score = Number(nearest.score);
  const suggestion: Suggestion =
    score >= EXTEND_THRESHOLD ? "extend" : score >= REVIEW_THRESHOLD ? "review" : "new";

  return {
    suggestion,
    nearNoteId: suggestion === "new" ? null : nearest.id,
    nearScore: score,
  };
}

/**
 * §06 step 4. A candidate close to something already dismissed is not proposed
 * again — otherwise every later turn re-offers the same rejected note.
 */
export async function wasDismissed(
  projectId: string,
  embedding: number[],
): Promise<boolean> {
  const vector = toVector(embedding);

  const rows = (await sql`
    select 1 - (embedding <=> ${vector}::vector) as score
    from note_candidates
    where project_id = ${projectId}
      and status = 'dismissed'
      and embedding is not null
    order by embedding <=> ${vector}::vector
    limit 1`) as { score: number }[];

  return rows.length > 0 && Number(rows[0].score) >= EXTEND_THRESHOLD;
}
