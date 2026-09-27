-- Rank Board schema — run this once in Supabase's SQL editor
-- (Database → SQL Editor → New query → paste → Run)

CREATE TABLE IF NOT EXISTS students (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  level           INTEGER NOT NULL DEFAULT 1,
  description     TEXT NOT NULL DEFAULT '',
  domain          TEXT NOT NULL DEFAULT '',
  avatar          TEXT,
  created_at      BIGINT NOT NULL,
  last_updated    BIGINT NOT NULL,
  last_level_up_at BIGINT NOT NULL,
  history         JSONB NOT NULL DEFAULT '[]'::jsonb,
  email           TEXT,
  phone           TEXT,
  github          TEXT,
  linkedin        TEXT,
  x_account       TEXT,
  password_hash   TEXT,
  role            TEXT DEFAULT 'student',
  is_blocked      BOOLEAN DEFAULT false,
  batch_id        TEXT,
  batch_status    TEXT
);

-- Speeds up the leaderboard sort (ORDER BY level DESC) once you have more students
CREATE INDEX IF NOT EXISTS students_level_idx ON students (level DESC);

-- Row Level Security: ON by default in Supabase. The app connects with the
-- service-role / direct Postgres connection string, which bypasses RLS,
-- so no policies are required for the server to work.
ALTER TABLE students ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS batches (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  created_by      TEXT NOT NULL,
  invite_code     TEXT NOT NULL UNIQUE,
  created_at      BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id              SERIAL PRIMARY KEY,
  sender_id       TEXT NOT NULL,
  receiver_id     TEXT,
  batch_id        TEXT NOT NULL,
  content         TEXT NOT NULL,
  is_edited       BOOLEAN DEFAULT false,
  read_status     TEXT DEFAULT 'sent',
  created_at      BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS hidden_messages (
  user_id TEXT NOT NULL,
  message_id INT NOT NULL,
  PRIMARY KEY (user_id, message_id)
);

CREATE TABLE IF NOT EXISTS chat_clears (
  user_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  cleared_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, room_id)
);

CREATE TABLE IF NOT EXISTS delete_requests (
  id              SERIAL PRIMARY KEY,
  student_id      TEXT NOT NULL,
  requested_at    BIGINT NOT NULL
);
