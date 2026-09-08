-- Sediment · §06 step 5, the half that was missing
--
-- "Seed a review row due in one day if the kind is concept." Accepting a
-- candidate wrote the note, parsed its links and stored its embedding, but
-- never scheduled it, so reviews has stayed empty and every concept accepted so
-- far is invisible to §09.
--
-- A seed is not a review, and rating was not null. Rather than write a rating
-- nobody gave — 0 means "could not retrieve it", which would be a lie sitting in
-- the data forever — rating becomes nullable and null means never reviewed. The
-- existing check passes on null, so it needs no change. interval_d and ease on a
-- seed row are the scheduler's opening state, which is what lets the SM-2 step
-- in §09 read the latest row uniformly instead of special-casing an empty one.
--
-- reviewed_at stays honest: it is when the row was written. What makes a seed a
-- seed is the null rating, not the timestamp.

alter table reviews alter column rating drop not null;

-- Concepts accepted before this migration. due_at runs from the note's own
-- created_at, so a note keeps the schedule it should have had.
insert into reviews (user_id, note_id, interval_d, ease, due_at)
select n.user_id, n.id, 1, 2.5, n.created_at + interval '1 day'
from notes n
where n.kind = 'concept'
  and n.deleted_at is null
  and n.merged_into is null
  and not exists (select 1 from reviews r where r.note_id = n.id);
