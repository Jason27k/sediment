const BASE = "https://api.voyageai.com/v1";

/** Voyage caps a single request at 1000 inputs; we stay well under to bound payload size. */
const BATCH = 96;

export const EMBED_MODEL = process.env.VOYAGE_EMBED_MODEL ?? "voyage-code-4";
export const RERANK_MODEL = process.env.VOYAGE_RERANK_MODEL ?? "rerank-2.5";

/** Must match vector(N) in migrations/0001_init.sql. */
export const EMBED_DIMENSIONS = 1024;

function key(): string {
  const value = process.env.VOYAGE_API_KEY;
  if (!value) throw new Error("VOYAGE_API_KEY is not set.");
  return value;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key()}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Voyage ${path} failed (${response.status}): ${detail.slice(0, 300)}`);
  }

  return response.json() as Promise<T>;
}

type EmbedResponse = { data: { index: number; embedding: number[] }[] };

/**
 * Embeds text for storage or for querying.
 *
 * Voyage distinguishes the two: "document" for corpus text, "query" for a
 * search string. Using the wrong one measurably degrades retrieval, so the
 * caller must be explicit.
 */
export async function embed(
  texts: string[],
  inputType: "document" | "query",
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const chunk = texts.slice(i, i + BATCH);
    const result = await post<EmbedResponse>("/embeddings", {
      input: chunk,
      model: EMBED_MODEL,
      input_type: inputType,
      output_dimension: EMBED_DIMENSIONS,
    });
    // Voyage returns results indexed within the batch, not necessarily in order.
    const ordered = new Array<number[]>(chunk.length);
    for (const row of result.data) ordered[row.index] = row.embedding;
    out.push(...ordered);
  }
  return out;
}

export async function embedOne(
  text: string,
  inputType: "document" | "query",
): Promise<number[]> {
  const [vector] = await embed([text], inputType);
  return vector;
}

type RerankResponse = { data: { index: number; relevance_score: number }[] };

/**
 * Reorders candidates against the query with a cross-encoder.
 *
 * Retrieval casts a wide net (§12 fuses keyword and vector ranking); this
 * narrows it. Reranking is where most of the retrieval quality lives, and
 * the free tier covers far more of it than this app will ever use.
 */
export async function rerank(
  query: string,
  documents: string[],
  topK: number,
): Promise<{ index: number; score: number }[]> {
  if (documents.length === 0) return [];

  const result = await post<RerankResponse>("/rerank", {
    query,
    documents,
    model: RERANK_MODEL,
    top_k: Math.min(topK, documents.length),
  });

  return result.data.map((row) => ({ index: row.index, score: row.relevance_score }));
}

/** Cosine similarity for in-memory comparisons; the database does its own via <=>. */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}
