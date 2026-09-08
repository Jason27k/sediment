-- Sediment · milestone 1
-- Spec §04. Embeddings are voyage-code-4 at 1024 dimensions.

create extension if not exists vector;

create table if not exists users (
  id          uuid primary key default gen_random_uuid(),
  email       text unique not null,
  name        text,
  image       text,
  created_at  timestamptz not null default now()
);

create table if not exists projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  name        text not null,
  slug        text not null,
  brief       text,
  created_at  timestamptz not null default now()
);

create unique index if not exists projects_user_slug on projects (user_id, slug);

create table if not exists notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  project_id  uuid not null references projects(id) on delete cascade,
  slug        text not null,
  title       text not null,
  body_md     text not null default '',
  kind        text not null default 'concept'
              check (kind in ('concept','recipe')),
  assumes     text,
  source_type text check (source_type in ('message','url','file')),
  source_ref  text,
  embedding   vector(1024),
  merged_into uuid references notes(id) on delete set null,
  archived_at timestamptz,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists notes_project_slug on notes (project_id, slug);
create index if not exists notes_embedding on notes using hnsw (embedding vector_cosine_ops);
create index if not exists notes_fts on notes
  using gin (to_tsvector('english', title || ' ' || body_md));
create index if not exists notes_project_live on notes (project_id, updated_at desc);

create view active_notes as
  select * from notes
  where deleted_at is null
    and merged_into is null
    and archived_at is null;

create table if not exists conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  project_id  uuid not null references projects(id) on delete cascade,
  title       text,
  created_at  timestamptz not null default now()
);

create table if not exists messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role            text not null check (role in ('user','assistant','system')),
  content         text not null,
  extracted_at    timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists messages_conversation on messages (conversation_id, created_at);
create index if not exists messages_fts on messages
  using gin (to_tsvector('english', content));

alter table conversations
  add column if not exists parent_note_id     uuid references notes(id)    on delete set null,
  add column if not exists parent_message_id  uuid references messages(id) on delete set null,
  add column if not exists anchor_title       text,
  add column if not exists anchor_snapshot_md text;

-- §06. The capture tray. Candidates are not notes and never appear in the corpus.
create table if not exists note_candidates (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  project_id   uuid not null references projects(id) on delete cascade,
  message_id   uuid references messages(id) on delete cascade,
  title        text not null,
  body_md      text not null,
  kind         text not null default 'concept'
               check (kind in ('concept','recipe')),
  assumes      text,
  embedding    vector(1024),
  status       text not null default 'pending'
               check (status in ('pending','accepted','dismissed','merged')),
  near_note_id uuid references notes(id) on delete set null,
  near_score   real,
  suggestion   text check (suggestion in ('new','review','extend')),
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists candidates_pending on note_candidates (project_id, status, created_at desc);
create index if not exists candidates_embedding on note_candidates using hnsw (embedding vector_cosine_ops);

create table if not exists note_links (
  from_note uuid not null references notes(id) on delete cascade,
  to_note   uuid not null references notes(id) on delete cascade,
  primary key (from_note, to_note)
);

create table if not exists canvas_positions (
  note_id   uuid primary key references notes(id) on delete cascade,
  x         real not null,
  y         real not null,
  collapsed boolean not null default false
);

create table if not exists reviews (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  note_id     uuid not null references notes(id) on delete cascade,
  rating      smallint not null check (rating between 0 and 3),
  interval_d  numeric not null,
  ease        numeric not null default 2.5,
  reviewed_at timestamptz not null default now(),
  due_at      timestamptz not null
);

create index if not exists reviews_due on reviews (user_id, due_at);
