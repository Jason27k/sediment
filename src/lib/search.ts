import { rows, sql, toVector } from "./db";
import { embedOne, rerank } from "./embed";

export type Hit = { id: string; slug: string; title: string; body_md: string; score: number };

/** Reciprocal rank fusion. k=60 is the conventional damping constant. */
function fuse(lists: string[][], k = 60): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, rank) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
    });
  }
  return scores;
}

/**
 * §12. Keyword ranking and vector similarity, fused, then reranked.
 *
 * Keyword matters more than usual here: API names and error strings are what
 * you actually search for, and an embedding will happily return something
 * conceptually adjacent that does not contain the identifier you typed.
 */
export async function searchNotes(
  projectId: string,
  query: string,
  limit = 6,
  pool = 30,
): Promise<Hit[]> {
  const vector = toVector(await embedOne(query, "query"));

  const [lexical, semantic] = await Promise.all([
    rows<{ id: string }>(sql`
      select id from active_notes
      where project_id = ${projectId}
        and to_tsvector('english', title || ' ' || body_md) @@ websearch_to_tsquery('english', ${query})
      order by ts_rank(to_tsvector('english', title || ' ' || body_md),
                       websearch_to_tsquery('english', ${query})) desc
      limit ${pool}`),
    rows<{ id: string }>(sql`
      select id from active_notes
      where project_id = ${projectId} and embedding is not null
      order by embedding <=> ${vector}::vector
      limit ${pool}`),
  ]);

  const fused = fuse([lexical.map((r) => r.id), semantic.map((r) => r.id)]);
  if (fused.size === 0) return [];

  const ids = [...fused.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id).slice(0, pool);

  const notes = (await sql`
    select id, slug, title, body_md from active_notes where id = any(${ids})`) as Omit<Hit, "score">[];

  // Preserve fused order before reranking, so a rerank failure degrades gracefully.
  const byId = new Map(notes.map((n) => [n.id, n]));
  const ordered = ids.map((id) => byId.get(id)).filter((n): n is Omit<Hit, "score"> => Boolean(n));

  try {
    const ranked = await rerank(query, ordered.map((n) => `${n.title}\n\n${n.body_md}`), limit);
    return ranked.map((r) => ({ ...ordered[r.index], score: r.score }));
  } catch {
    return ordered.slice(0, limit).map((n) => ({ ...n, score: fused.get(n.id) ?? 0 }));
  }
}
