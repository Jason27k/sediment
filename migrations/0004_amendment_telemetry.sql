-- Sediment · §07 amendment telemetry
--
-- §06 records accepts and dismissals from the first day so that tuning the
-- dedupe thresholds rests on a fortnight of evidence rather than on how the
-- tray felt after one bad session. Amendments had no equivalent: applying one
-- bumped updated_at and discarding one did nothing at all, so the two questions
-- worth asking would have been answerable only from memory.
--
-- The questions are the apply rate on proposals, and whether an amended note
-- keeps the size of a note across repeated branches. Both bodies are stored so
-- the second is answerable from these rows alone, and so a diff stays
-- reconstructable long after the note has moved on.
--
-- Statuses are terminal except 'proposed'. 'superseded' is a proposal re-rolled
-- before it was ruled on, which is a weaker signal than a discard and is kept
-- separate so it cannot quietly deflate the apply rate. 'no_change' is the
-- branch confirming the note was already right — a real outcome, not a failure.

create table if not exists note_amendments (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  note_id         uuid not null references notes(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  before_title    text not null,
  before_body_md  text not null,
  after_title     text not null,
  after_body_md   text not null,
  rationale       text,
  status          text not null default 'proposed'
                  check (status in ('proposed','applied','discarded','superseded','no_change')),
  resolved_at     timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists amendments_note on note_amendments (note_id, created_at desc);
create index if not exists amendments_outcome on note_amendments (user_id, status, created_at desc);
