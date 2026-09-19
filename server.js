// Rank Board server — Postgres/Supabase-backed.
// Same API contract as the original flat-file version, so public/app.js and
// public/index.html are untouched. Only the storage layer changed.

require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const cloudinary = require('cloudinary').v2;
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-dev-secret-key-123';

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

// --- AUTH MIDDLEWARE ---
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token == null) return res.sendStatus(401);
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}
function isAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({error: 'Admin only'});
  next();
}

// --- AUTH ROUTES ---
app.post('/api/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({error: 'Missing fields'});
  try {
    const { rows } = await pool.query('SELECT * FROM students WHERE email = $1', [email]);
    if (rows.length > 0) return res.status(400).json({error: 'Email already exists'});
    
    const hash = await bcrypt.hash(password, 10);
    const id = crypto.randomUUID();
    const now = Date.now();
    
    // First user is admin
    const countRes = await pool.query('SELECT COUNT(*) FROM students');
    const isFirst = parseInt(countRes.rows[0].count) === 0;
    const role = isFirst ? 'admin' : 'student';

    await pool.query(
      `INSERT INTO students (id, name, email, password_hash, role, created_at, last_updated, last_level_up_at) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, name, email, hash, role, now, now, now]
    );
    res.json({ message: 'Registered successfully. Please login.' });
  } catch(err) {
    console.error(err);
    res.status(500).json({error: 'DB error'});
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const { rows } = await pool.query('SELECT * FROM students WHERE email = $1', [email]);
    if (rows.length === 0) return res.status(400).json({error: 'Invalid credentials'});
    
    const user = rows[0];
    if (user.is_blocked) return res.status(403).json({error: 'Account blocked'});
    
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(400).json({error: 'Invalid credentials'});
    
    const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: { id: user.id, name: user.name, role: user.role, level: user.level } });
  } catch(err) {
    res.status(500).json({error: 'DB error'});
  }
});

// Mock OTP storage (email -> {code, expires})
const otpStore = new Map();

app.post('/api/forgot-password', async (req, res) => {
  const { email } = req.body;
  try {
    const { rows } = await pool.query('SELECT * FROM students WHERE email = $1', [email]);
    if (rows.length === 0) return res.status(400).json({error: 'Email not found'});
    
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore.set(email, { code: otp, expires: Date.now() + 15 * 60000 });
    
    // In production, send via EmailJS or Nodemailer here
    console.log(`\n--- OTP GENERATED FOR ${email}: ${otp} ---\n`);
    
    res.json({ message: 'OTP sent to email (check server console)' });
  } catch(err) {
    res.status(500).json({error: 'DB error'});
  }
});

app.post('/api/reset-password', async (req, res) => {
  const { email, otp, newPassword } = req.body;
  const stored = otpStore.get(email);
  if (!stored || stored.code !== otp || Date.now() > stored.expires) {
    return res.status(400).json({error: 'Invalid or expired OTP'});
  }
  try {
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE students SET password_hash = $1 WHERE email = $2', [hash, email]);
    otpStore.delete(email);
    res.json({ message: 'Password reset successful' });
  } catch(err) {
    res.status(500).json({error: 'DB error'});
  }
});

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
    // Don't leak passwords!
    const safeRows = rows.map(r => {
      delete r.password_hash;
      return r;
    });
    res.json(safeRows.map(rowToStudent).map(withComputed));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'database error' });
  }
});

// Helper to verify user or admin
async function verifyUserOrAdmin(req, id) {
  // If admin passcode provided, bypass
  const adminPasscode = req.headers['x-admin-passcode'];
  if (adminPasscode === ADMIN_PASSWORD) return true;
  
  // Otherwise verify user's password
  const { password } = req.body || {};
  if (!password) return false;
  
  const { rows } = await pool.query('SELECT password_hash FROM students WHERE id = $1', [id]);
  if (!rows[0] || !rows[0].password_hash) return false;
  
  return await bcrypt.compare(password, rows[0].password_hash);
}

// Create a student
app.post('/api/students', async (req, res) => {
  try {
    const { name, email, password, level, description, domain, avatar } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
    if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
    
    const hash = await bcrypt.hash(password, 10);
    const lvl = clampLevel(level);
    const now = Date.now();
    const avatarUrl = await uploadAvatar(avatar);
    const student = {
      id: uid(),
      name: String(name).trim().slice(0, 60),
      email: String(email).trim().slice(0, 100),
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
        (id, name, email, password_hash, level, description, domain, avatar, created_at, last_updated, last_level_up_at, history)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        student.id, student.name, student.email, hash, student.level, student.description, student.domain, student.avatar,
        student.createdAt, student.lastUpdated, student.lastLevelUpAt,
        JSON.stringify(student.history),
      ]
    );
    res.status(201).json(withComputed(student));
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

// Update a student (name / level / description / domain / avatar)
app.patch('/api/students/:id', async (req, res) => {
  try {
    const isAuth = await verifyUserOrAdmin(req, req.params.id);
    if (!isAuth) return res.status(401).json({ error: 'Unauthorized: Admin passcode or correct password required' });

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
    const isAuth = await verifyUserOrAdmin(req, req.params.id);
    if (!isAuth) return res.status(401).json({ error: 'Unauthorized: Admin passcode or correct password required' });

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

// Delete a student
app.delete('/api/students/:id', async (req, res) => {
  try {
    const isAuth = await verifyUserOrAdmin(req, req.params.id);
    if (!isAuth) return res.status(401).json({ error: 'Unauthorized: Admin passcode or correct password required' });

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
        is_blocked      BOOLEAN DEFAULT false
      );
      CREATE INDEX IF NOT EXISTS students_level_idx ON students (level DESC);
      ALTER TABLE students ADD COLUMN IF NOT EXISTS domain TEXT NOT NULL DEFAULT '';
      ALTER TABLE students ADD COLUMN IF NOT EXISTS email TEXT;
      ALTER TABLE students ADD COLUMN IF NOT EXISTS phone TEXT;
      ALTER TABLE students ADD COLUMN IF NOT EXISTS github TEXT;
      ALTER TABLE students ADD COLUMN IF NOT EXISTS linkedin TEXT;
      ALTER TABLE students ADD COLUMN IF NOT EXISTS x_account TEXT;
      ALTER TABLE students ADD COLUMN IF NOT EXISTS password_hash TEXT;
      ALTER TABLE students ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'student';
      ALTER TABLE students ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT false;
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

