-- Sediment · §08 rolling summary
--
-- The last piece of the fixed context budget. Recent turns are verbatim and
-- notes are retrieved, but the turns that age out of the window leave a hole:
-- the summary covers only what the notes did not capture, in ~400 tokens.
--
-- summary_through_count is how many of the conversation's messages, in
-- created_at order, the summary already covers. Storing a count rather than a
-- message id keeps the "regenerate every N turns" check to arithmetic.

alter table conversations
  add column if not exists summary               text,
  add column if not exists summary_through_count integer not null default 0;
