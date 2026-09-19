// Rank Board server — Postgres/Supabase-backed.
// Same API contract as the original flat-file version, so public/app.js and
// public/index.html are untouched. Only the storage layer changed.

require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

async function uploadAvatar(base64Str) {
  if (!base64Str || !base64Str.startsWith('data:image')) return base64Str;
  try {
    const result = await cloudinary.uploader.upload(base64Str, {
      folder: 'rank-board-avatars',
      width: 200,
      crop: "scale"
    });
    return result.secure_url;
  } catch (err) {
    console.error("Cloudinary upload error:", err);
    return null;
  }
}

const PORT = process.env.PORT || 3000;
const MAX_LEVEL = 52;

if (!process.env.DATABASE_URL) {
  console.error(
    '\nMissing DATABASE_URL. Copy .env.example to .env and paste your ' +
    'Supabase connection string in, or set DATABASE_URL in your host\'s ' +
    'environment variables.\n'
  );
  process.exit(1);
}

// ---- Postgres connection pool ----------------------------------------------
// Supabase (and most managed Postgres hosts) require SSL. Their certs chain
// to a public CA, but Node's default bundle doesn't always have it, so we
// accept the connection without verifying the chain — fine for this use case
// since the connection string itself is the secret that authenticates you.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

pool.on('error', (err) => {
  // A dropped idle connection shouldn't crash the whole server.
  console.error('Unexpected Postgres pool error:', err.message);
});

async function withRetry(fn, attempts = 2) {
  try {
    return await fn();
  } catch (err) {
    if (attempts <= 1) throw err;
    await new Promise((r) => setTimeout(r, 300));
    return withRetry(fn, attempts - 1);
  }
}

function rowToStudent(r) {
  return {
    id: r.id,
    name: r.name,
    level: r.level,
    description: r.description || '',
    domain: r.domain || '',
    avatar: r.avatar || null,
    createdAt: Number(r.created_at),
    lastUpdated: Number(r.last_updated),
    lastLevelUpAt: Number(r.last_level_up_at),
    history: r.history || [],
  };
}

function uid() {
  return 's' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
}

function clampLevel(level) {
  let lvl = parseInt(level, 10);
  if (isNaN(lvl)) lvl = 1;
  return Math.min(MAX_LEVEL, Math.max(1, lvl));
}

// Adds streak/staleness fields the frontend uses to draw the trend track.
function withComputed(s) {
  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const sinceLevelChange = now - (s.lastLevelUpAt || s.lastUpdated || s.createdAt || now);
  const weeksStale = Math.max(0, Math.floor(sinceLevelChange / weekMs));
  const justLeveledUp = sinceLevelChange < (48 * 60 * 60 * 1000);
  return { ...s, weeksStale, justLeveledUp };
}

// Ensure the domain column exists on startup
(async function initDB() {
  try {
    await pool.query('ALTER TABLE students ADD COLUMN IF NOT EXISTS domain text DEFAULT \'\'');
  } catch (err) {
    console.error('Migration error:', err.message);
  }
})();

// ==== Endpoints ==== //

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'secret';

function requireAdmin(req, res, next) {
  if (req.headers['x-admin-passcode'] === ADMIN_PASSWORD) {
    return next();
  }
  return res.status(401).json({ error: 'unauthorized' });
}

// ---- app ---------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '5mb' })); // generous, avatars are base64
app.use(express.static(path.join(__dirname, 'public')));

// Admin verification endpoint
app.post('/api/admin/verify', (req, res) => {
  const { passcode } = req.body || {};
  if (passcode === ADMIN_PASSWORD) {
    return res.json({ success: true });
  }
  return res.status(401).json({ success: false, error: 'Incorrect passcode' });
});

// List all students
app.get('/api/students', async (req, res) => {
  try {
    const { rows } = await withRetry(() =>
      pool.query('SELECT * FROM students ORDER BY level DESC, name ASC')
    );
    res.json(rows.map(rowToStudent).map(withComputed));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'database error' });
  }
});

// Create a student (Admin Protected)
app.post('/api/students', requireAdmin, async (req, res) => {
  try {
    const { name, level, description, domain, avatar } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
    const lvl = clampLevel(level);
    const now = Date.now();
    const avatarUrl = await uploadAvatar(avatar);
    const student = {
      id: uid(),
      name: String(name).trim().slice(0, 60),
      level: lvl,
      description: (description || '').slice(0, 240),
      domain: (domain || '').slice(0, 60),
      avatar: avatarUrl || null,
      createdAt: now,
      lastUpdated: now,
      lastLevelUpAt: now,
      history: [{ level: lvl, at: now }],
    };
    await pool.query(
      `INSERT INTO students
        (id, name, level, description, domain, avatar, created_at, last_updated, last_level_up_at, history)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        student.id, student.name, student.level, student.description, student.domain, student.avatar,
        student.createdAt, student.lastUpdated, student.lastLevelUpAt,
        JSON.stringify(student.history),
      ]
    );
    res.status(201).json(withComputed(student));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'database error' });
  }
});

// Update a student (name / level / description / domain / avatar) (Admin Protected)
app.patch('/api/students/:id', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM students WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    const s = rowToStudent(rows[0]);

    const { name, level, description, domain, avatar } = req.body || {};
    const now = Date.now();

    if (typeof name === 'string' && name.trim()) s.name = name.trim().slice(0, 60);
    if (typeof description === 'string') s.description = description.slice(0, 240);
    if (typeof domain === 'string') s.domain = domain.slice(0, 60);
    if (typeof avatar === 'string' || avatar === null) {
      s.avatar = await uploadAvatar(avatar);
    }

    if (level !== undefined && level !== null) {
      const lvl = clampLevel(level);
      if (lvl !== s.level) {
        s.level = lvl;
        s.lastLevelUpAt = now;
        s.history = s.history || [];
        s.history.push({ level: lvl, at: now });
      }
    }
    s.lastUpdated = now;

    await pool.query(
      `UPDATE students
       SET name = $1, level = $2, description = $3, domain = $4, avatar = $5,
           last_updated = $6, last_level_up_at = $7, history = $8
       WHERE id = $9`,
      [
        s.name, s.level, s.description, s.domain, s.avatar,
        s.lastUpdated, s.lastLevelUpAt, JSON.stringify(s.history),
        s.id
      ]
    );

    res.json(withComputed(s));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'database error' });
  }
});

// Bump level up/down by 1 (used by the +/- buttons)
app.post('/api/students/:id/bump', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM students WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    const s = rowToStudent(rows[0]);

    const dir = req.body && req.body.dir === 'down' ? -1 : 1;
    const newLevel = clampLevel(s.level + dir);
    const now = Date.now();
    if (newLevel !== s.level) {
      s.level = newLevel;
      s.lastLevelUpAt = now;
      s.history = s.history || [];
      s.history.push({ level: newLevel, at: now });
      if (s.history.length > 100) s.history = s.history.slice(-100);
    }
    s.lastUpdated = now;

    await pool.query(
      `UPDATE students SET level=$1, last_updated=$2, last_level_up_at=$3, history=$4
       WHERE id=$5`,
      [s.level, s.lastUpdated, s.lastLevelUpAt, JSON.stringify(s.history), s.id]
    );
    res.json(withComputed(s));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'database error' });
  }
});

// Delete a student (Admin Protected)
app.delete('/api/students/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM delete_requests WHERE student_id = $1', [req.params.id]);
    const result = await pool.query('DELETE FROM students WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'not found' });
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'database error' });
  }
});

// Request deletion of a student
app.post('/api/students/:id/delete-request', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id FROM students WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    
    await pool.query(
      'INSERT INTO delete_requests (student_id, requested_at) VALUES ($1, $2)',
      [req.params.id, Date.now()]
    );
    res.json({ success: true, message: 'Deletion request sent to admin.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'database error' });
  }
});

// Export / import (backup) — same shape as the old file-backed version, so
// any backup JSON you already exported still imports cleanly.
app.get('/api/export', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM students ORDER BY created_at ASC');
    res.setHeader('Content-Disposition', 'attachment; filename="rankboard-backup.json"');
    res.json(rows.map(rowToStudent));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'database error' });
  }
});

app.post('/api/import', async (req, res, next) => {
  const mode = req.query.mode === 'merge' ? 'merge' : 'replace';
  if (mode === 'replace') {
    return requireAdmin(req, res, () => handleImport(req, res, mode));
  }
  return handleImport(req, res, mode);
});

async function handleImport(req, res, mode) {
  const client = await pool.connect();
  try {
    const incoming = req.body;
    if (!Array.isArray(incoming)) return res.status(400).json({ error: 'expected an array' });
    const mode = req.query.mode === 'merge' ? 'merge' : 'replace';

    await client.query('BEGIN');
    if (mode === 'replace') await client.query('DELETE FROM students');

    for (const d of incoming) {
      const lvl = clampLevel(d.level);
      const now = Date.now();
      await client.query(
        `INSERT INTO students
          (id, name, level, description, avatar, created_at, last_updated, last_level_up_at, history)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO UPDATE SET
           name=EXCLUDED.name, level=EXCLUDED.level, description=EXCLUDED.description,
           avatar=EXCLUDED.avatar, last_updated=EXCLUDED.last_updated,
           last_level_up_at=EXCLUDED.last_level_up_at, history=EXCLUDED.history`,
        [
          d.id || uid(),
          String(d.name || 'Unnamed').slice(0, 60),
          lvl,
          (d.description || '').slice(0, 240),
          d.avatar || null,
          d.createdAt || now,
          d.lastUpdated || now,
          d.lastLevelUpAt || d.lastUpdated || now,
          JSON.stringify(Array.isArray(d.history) ? d.history : [{ level: lvl, at: now }]),
        ]
      );
    }
    await client.query('COMMIT');

    const { rows } = await pool.query('SELECT * FROM students ORDER BY level DESC, name ASC');
    res.json(rows.map(rowToStudent).map(withComputed));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'database error' });
  } finally {
    client.release();
  }
}

// Simple health check — useful for uptime pings (see README, "keep it warm")
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false });
  }
});

// Auto-initialize schema on startup
async function initDb() {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS students (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        level           INTEGER NOT NULL DEFAULT 1,
        description     TEXT NOT NULL DEFAULT '',
        avatar          TEXT,
        created_at      BIGINT NOT NULL,
        last_updated    BIGINT NOT NULL,
        last_level_up_at BIGINT NOT NULL,
        history         JSONB NOT NULL DEFAULT '[]'::jsonb
      );
      CREATE INDEX IF NOT EXISTS students_level_idx ON students (level DESC);
      ALTER TABLE students ENABLE ROW LEVEL SECURITY;
      
      CREATE TABLE IF NOT EXISTS delete_requests (
        id              SERIAL PRIMARY KEY,
        student_id      TEXT NOT NULL,
        requested_at    BIGINT NOT NULL
      );
    `);
    console.log('✓ Database schema verified/initialized (students table & index ready).');
  } catch (err) {
    console.warn('Note on DB init check:', err.message);
  }
}

app.listen(PORT, () => {
  console.log(`Rank Board running at http://localhost:${PORT}`);
  initDb();
});

