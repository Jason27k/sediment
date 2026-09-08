-- Sediment · email + password auth (Better Auth)
--
-- Spec §15 said "do not build session handling, password reset, or email
-- verification" — this keeps that promise with a library rather than with
-- GitHub OAuth. Better Auth is pointed at the existing `users` table via
-- `modelName` and issues uuid ids, so every `user_id uuid references users(id)`
-- in 0001 keeps working and no query in src/lib changes.
--
-- The DDL below is what `getMigrations()` compiled against the live schema;
-- `if not exists` and the name backfill are the only hand edits.

-- Better Auth declares `name` required. Existing rows may hold null.
update users set name = '' where name is null;
alter table users alter column name set not null;

alter table users add column if not exists email_verified boolean default false not null;
alter table users add column if not exists updated_at timestamptz default current_timestamp not null;

create table if not exists session (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  token       text not null unique,
  expires_at  timestamptz not null,
  ip_address  text,
  user_agent  text,
  created_at  timestamptz not null default current_timestamp,
  updated_at  timestamptz not null default current_timestamp
);

-- Holds the password hash in `password`. The oauth columns stay for the day
-- social login is added back; email+password never touches them.
create table if not exists account (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null references users(id) on delete cascade,
  account_id                  text not null,
  provider_id                 text not null,
  password                    text,
  access_token                text,
  refresh_token               text,
  id_token                    text,
  access_token_expires_at     timestamptz,
  refresh_token_expires_at    timestamptz,
  scope                       text,
  created_at                  timestamptz not null default current_timestamp,
  updated_at                  timestamptz not null default current_timestamp
);

create table if not exists verification (
  id          uuid primary key default gen_random_uuid(),
  identifier  text not null,
  value       text not null,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default current_timestamp,
  updated_at  timestamptz not null default current_timestamp
);

create index if not exists session_user_id_idx on session (user_id);
create index if not exists account_user_id_idx on account (user_id);
create index if not exists verification_identifier_idx on verification (identifier);
