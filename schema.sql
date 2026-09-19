-- Rank Board schema — run this once in Supabase's SQL editor
-- (Database → SQL Editor → New query → paste → Run)

create table if not exists students (
  id              text primary key,
  name            text not null,
  level           integer not null default 1,
  description     text not null default '',
  domain          text not null default '',
  avatar          text,                         -- base64 data URL or null
  created_at      bigint not null,               -- epoch ms, matches old JSON store
  last_updated    bigint not null,
  last_level_up_at bigint not null,
  history         jsonb not null default '[]'::jsonb,
  email           text,
  phone           text,
  github          text,
  linkedin        text,
  x_account       text,
  password_hash   text,
  role            text default 'student',
  is_blocked      boolean default false
);

-- Speeds up the leaderboard sort (ORDER BY level DESC) once you have more students
create index if not exists students_level_idx on students (level desc);

-- Row Level Security: ON by default in Supabase. The app connects with the
-- service-role / direct Postgres connection string, which bypasses RLS,
-- so no policies are required for the server to work. If you ever want
-- students to query Supabase directly from the browser (skipping this
-- Express server), you'd add RLS policies here instead.
alter table students enable row level security;
