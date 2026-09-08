import { sql } from "./db";
import type { Note } from "./types";

/** §06 step 5. A newly accepted concept is due tomorrow. */
export const SEED_INTERVAL_DAYS = 1;
/** §09. SM-2's opening ease, before any rating has moved it. */
export const INITIAL_EASE = 2.5;

/**
 * Puts a note into the review schedule.
 *
 * Only concepts are scheduled (§09): a recipe decays with the next major
 * version and is looked up rather than recalled, and letting recipes into the
 * queue fills it with configuration trivia until the queue gets abandoned.
 *
 * The seed row carries a null rating because nothing has been rated yet. It
 * exists so that the scheduler always has a latest row to read — an interval and
 * an ease it can step from — rather than one code path for the first review and
 * another for every review after it.
 */
export async function seedReview(note: Pick<Note, "id" | "user_id" | "kind">): Promise<void> {
  if (note.kind !== "concept") return;

  await sql`
    insert into reviews (user_id, note_id, interval_d, ease, due_at)
    values (${note.user_id}, ${note.id}, ${SEED_INTERVAL_DAYS}, ${INITIAL_EASE},
            now() + ${`${SEED_INTERVAL_DAYS} days`}::interval)`;
}
