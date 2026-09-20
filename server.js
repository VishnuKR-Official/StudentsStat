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
const { createServer } = require('http');
const { Server } = require('socket.io');

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
    github: r.github || '',
    linkedin: r.linkedin || '',
    x_account: r.x_account || '',
    role: r.role || 'student',
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
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" }
});
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

// Global Admin Login
app.post('/api/admin/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    const tokenUser = { id: 'admin', name: 'Global Admin', role: 'global_admin', batch_id: null, batch_status: null, batch_name: null };
    const token = jwt.sign(tokenUser, JWT_SECRET, { expiresIn: '24h' });
    return res.json({ token, user: tokenUser });
  }
  return res.status(401).json({ error: 'Invalid admin password' });
});

// Get all batches (Global Admin)
app.get('/api/admin/batches', authenticateToken, async (req, res) => {
  if (req.user.role !== 'global_admin') return res.status(403).json({ error: 'Forbidden' });
  try {
    const { rows } = await pool.query('SELECT * FROM batches ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'DB error' });
  }
});

// Enter Batch (Global Admin)
app.post('/api/admin/enter-batch', authenticateToken, async (req, res) => {
  if (req.user.role !== 'global_admin') return res.status(403).json({ error: 'Forbidden' });
  const { batch_id } = req.body;
  try {
    const { rows } = await pool.query('SELECT * FROM batches WHERE id = $1', [batch_id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Batch not found' });
    const tokenUser = { ...req.user, batch_id: rows[0].id, batch_name: rows[0].name };
    const token = jwt.sign(tokenUser, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: tokenUser });
  } catch (err) {
    res.status(500).json({ error: 'DB error' });
  }
});

// Batch Name Edit
app.put('/api/batches/:id/name', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'global_admin') {
    return res.status(403).json({ error: 'Only admins can edit the batch name' });
  }
  if (req.user.role === 'admin' && req.user.batch_id !== req.params.id) {
    return res.status(403).json({ error: 'You can only edit your own batch name' });
  }
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    await pool.query('UPDATE batches SET name = $1 WHERE id = $2', [name, req.params.id]);
    res.json({ success: true, name });
  } catch (err) {
    res.status(500).json({ error: 'DB error' });
  }
});

// Role Toggle (Promote to Admin)
app.post('/api/students/:id/role', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'global_admin') {
    return res.status(403).json({ error: 'Only admins can promote users' });
  }
  const { role } = req.body;
  if (role !== 'admin' && role !== 'student') return res.status(400).json({ error: 'Invalid role' });
  try {
    // If not global admin, ensure the student is in the same batch
    if (req.user.role !== 'global_admin') {
      const sRes = await pool.query('SELECT batch_id FROM students WHERE id = $1', [req.params.id]);
      if (sRes.rows.length === 0 || sRes.rows[0].batch_id !== req.user.batch_id) {
        return res.status(403).json({ error: 'You can only manage users in your own batch' });
      }
    }
    await pool.query('UPDATE students SET role = $1 WHERE id = $2', [role, req.params.id]);
    res.json({ success: true, role });
  } catch (err) {
    res.status(500).json({ error: 'DB error' });
  }
});

// --- AUTH ROUTES ---
app.post('/api/register', async (req, res) => {
  const { name, email, password, inviteCode } = req.body;
  if (!name || !email || !password) return res.status(400).json({error: 'Missing fields'});
  try {
    const { rows } = await pool.query('SELECT * FROM students WHERE email = $1', [email]);
    if (rows.length > 0) return res.status(400).json({error: 'Email already exists'});
    
    let batchId = null;
    let batchStatus = null;
    if (inviteCode) {
      const batchRes = await pool.query('SELECT id FROM batches WHERE invite_code = $1', [inviteCode]);
      if (batchRes.rows.length === 0) return res.status(400).json({error: 'Invalid invite code'});
      batchId = batchRes.rows[0].id;
      batchStatus = 'pending';
    }
    
    const hash = await bcrypt.hash(password, 10);
    const id = crypto.randomUUID();
    const now = Date.now();

    await pool.query(
      `INSERT INTO students (id, name, email, password_hash, role, created_at, last_updated, last_level_up_at, batch_id, batch_status) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [id, name, email, hash, 'student', now, now, now, batchId, batchStatus]
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
    
    let isBatchAdmin = false;
    let batchName = null;
    if (user.batch_id) {
      const bRes = await pool.query('SELECT * FROM batches WHERE id = $1', [user.batch_id]);
      if (bRes.rows.length > 0) {
        batchName = bRes.rows[0].name;
        isBatchAdmin = (bRes.rows[0].created_by === user.id) || (user.role === 'admin');
      }
    }
    
    // role is dynamic now based on batch admin status, but we'll still pass the raw role just in case.
    const tokenUser = { 
      id: user.id, name: user.name, role: isBatchAdmin ? 'admin' : 'student',
      batch_id: user.batch_id, batch_status: user.batch_status, batch_name: batchName 
    };
    
    const token = jwt.sign(tokenUser, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: tokenUser });
  } catch(err) {
    res.status(500).json({error: 'DB error'});
  }
});

app.get('/api/me', authenticateToken, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM students WHERE id = $1', [req.user.id]);
    if (rows.length === 0) return res.status(404).json({error: 'User not found'});
    const user = rows[0];
    
    let isBatchAdmin = false;
    let batchName = null;
    if (user.batch_id) {
      const bRes = await pool.query('SELECT * FROM batches WHERE id = $1', [user.batch_id]);
      if (bRes.rows.length > 0) {
        batchName = bRes.rows[0].name;
        isBatchAdmin = (bRes.rows[0].created_by === user.id) || (user.role === 'admin');
      }
    }
    
    const tokenUser = { 
      id: user.id, name: user.name, role: isBatchAdmin ? 'admin' : 'student',
      batch_id: user.batch_id, batch_status: user.batch_status, batch_name: batchName 
    };
    
    const token = jwt.sign(tokenUser, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: tokenUser });
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

// --- BATCH ENDPOINTS ---

app.post('/api/batches', authenticateToken, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({error: 'Batch name required'});
  try {
    const batchId = crypto.randomUUID();
    const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    await pool.query(
      'INSERT INTO batches (id, name, created_by, invite_code, created_at) VALUES ($1, $2, $3, $4, $5)',
      [batchId, name, req.user.id, inviteCode, Date.now()]
    );
    await pool.query(
      'UPDATE students SET batch_id = $1, batch_status = $2, role = $3 WHERE id = $4',
      [batchId, 'approved', 'admin', req.user.id]
    );

    // Generate fresh token
    const tokenUser = { 
      id: req.user.id, name: req.user.name, role: 'admin',
      batch_id: batchId, batch_status: 'approved', batch_name: name 
    };
    const token = jwt.sign(tokenUser, JWT_SECRET, { expiresIn: '24h' });

    res.json({ message: 'Batch created', batch_id: batchId, invite_code: inviteCode, token, user: tokenUser });
  } catch(err) {
    console.error(err);
    res.status(500).json({error: 'DB error'});
  }
});

app.post('/api/batches/join', authenticateToken, async (req, res) => {
  const { inviteCode } = req.body;
  try {
    const bRes = await pool.query('SELECT id FROM batches WHERE invite_code = $1', [inviteCode]);
    if (bRes.rows.length === 0) return res.status(400).json({error: 'Invalid invite code'});
    const batchId = bRes.rows[0].id;
    await pool.query(
      'UPDATE students SET batch_id = $1, batch_status = $2 WHERE id = $3',
      [batchId, 'pending', req.user.id]
    );
    res.json({ message: 'Request to join sent. Waiting for admin approval.' });
  } catch(err) {
    console.error(err);
    res.status(500).json({error: 'DB error'});
  }
});

app.get('/api/batches/my-batch', authenticateToken, async (req, res) => {
  if (!req.user.batch_id) return res.status(400).json({error: 'Not in a batch'});
  try {
    const { rows } = await pool.query('SELECT * FROM batches WHERE id = $1', [req.user.batch_id]);
    if (rows.length === 0) return res.status(404).json({error: 'Batch not found'});
    res.json(rows[0]);
  } catch(err) {
    console.error(err);
    res.status(500).json({error: 'DB error'});
  }
});

app.get('/api/batches/pending', authenticateToken, async (req, res) => {
  if (!req.user.batch_id) return res.status(400).json({error: 'Not in a batch'});
  if (req.user.role !== 'admin' && req.user.role !== 'global_admin') return res.status(403).json({error: 'Only batch admin can view pending'});
  try {
    const { rows } = await pool.query('SELECT id, name, email FROM students WHERE batch_id = $1 AND batch_status = $2', [req.user.batch_id, 'pending']);
    res.json(rows);
  } catch(err) {
    console.error(err);
    res.status(500).json({error: 'DB error'});
  }
});

app.post('/api/batches/approve/:studentId', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({error: 'Only batch admin can approve'});
  try {
    await pool.query('UPDATE students SET batch_status = $1 WHERE id = $2 AND batch_id = $3', ['approved', req.params.studentId, req.user.batch_id]);
    res.json({ success: true });
  } catch(err) {
    console.error(err);
    res.status(500).json({error: 'DB error'});
  }
});

app.post('/api/batches/reject/:studentId', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({error: 'Only batch admin can reject'});
  try {
    await pool.query('UPDATE students SET batch_id = NULL, batch_status = NULL WHERE id = $1 AND batch_id = $2', [req.params.studentId, req.user.batch_id]);
    res.json({ success: true });
  } catch(err) {
    console.error(err);
    res.status(500).json({error: 'DB error'});
  }
});

app.post('/api/students/:id/role', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({error: 'Only admin can change roles'});
  try {
    // Only allow setting role to 'admin' or 'student'
    const newRole = req.body.role === 'admin' ? 'admin' : 'student';
    // Ensure the target student is actually in the same batch
    const { rows } = await pool.query('SELECT batch_id, role FROM students WHERE id = $1', [req.params.id]);
    if (rows.length === 0 || rows[0].batch_id !== req.user.batch_id) {
      return res.status(404).json({error: 'Student not found in your batch'});
    }
    // Prevent removing own admin privileges to avoid getting locked out, unless there's another admin? No need to overcomplicate.
    if (req.params.id === req.user.id && newRole !== 'admin') {
      return res.status(400).json({error: 'Cannot remove your own admin privileges'});
    }
    
    await pool.query('UPDATE students SET role = $1 WHERE id = $2', [newRole, req.params.id]);
    res.json({ success: true, role: newRole });
  } catch(err) {
    console.error(err);
    res.status(500).json({error: 'DB error'});
  }
});

app.post('/api/students/:id/block', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({error: 'Only admin can block users'});
  try {
    const { rows } = await pool.query('SELECT batch_id FROM students WHERE id = $1', [req.params.id]);
    if (rows.length === 0 || rows[0].batch_id !== req.user.batch_id) {
      return res.status(404).json({error: 'Student not found in your batch'});
    }
    if (req.params.id === req.user.id) {
      return res.status(400).json({error: 'Cannot block yourself'});
    }
    
    await pool.query('UPDATE students SET is_blocked = true, batch_id = NULL, batch_status = NULL, role = $2 WHERE id = $1', [req.params.id, 'student']);
    res.json({ success: true });
  } catch(err) {
    console.error(err);
    res.status(500).json({error: 'DB error'});
  }
});

app.post('/api/batches/leave', authenticateToken, async (req, res) => {
  try {
    await pool.query('UPDATE students SET batch_id = NULL, batch_status = NULL, role = $2 WHERE id = $1', [req.user.id, 'student']);
    res.json({ success: true });
  } catch(err) {
    console.error(err);
    res.status(500).json({error: 'DB error'});
  }
});

// List all approved students in the current user's batch
app.get('/api/students', authenticateToken, async (req, res) => {
  if (!req.user.batch_id) return res.json([]);
  try {
    const { rows } = await withRetry(() =>
      pool.query('SELECT * FROM students WHERE batch_id = $1 AND batch_status = $2 ORDER BY level DESC, name ASC', [req.user.batch_id, 'approved'])
    );
    const safeRows = rows.map(r => { delete r.password_hash; return r; });
    res.json(safeRows.map(rowToStudent).map(withComputed));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'database error' });
  }
});

// Helper to verify user or admin using JWT payload
function verifyUserOwnershipOrAdmin(req, id) {
  if (!req.user) return false;
  return req.user.role === 'admin' || req.user.id === id;
}

// Create a student
app.post('/api/students', async (req, res) => {
  try {
    const { name, email, password, level, description, domain, avatar, github, linkedin, x_account } = req.body || {};
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
      github: (github || '').slice(0, 255),
      linkedin: (linkedin || '').slice(0, 255),
      x_account: (x_account || '').slice(0, 255),
      createdAt: now,
      lastUpdated: now,
      lastLevelUpAt: now,
      history: [{ level: lvl, at: now }],
    };
    await pool.query(
      `INSERT INTO students
        (id, name, email, password_hash, level, description, domain, avatar, github, linkedin, x_account, created_at, last_updated, last_level_up_at, history)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        student.id, student.name, student.email, hash, student.level, student.description, student.domain, student.avatar,
        student.github, student.linkedin, student.x_account,
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

// Update a student (name / level / description / domain / avatar / social)
app.patch('/api/students/:id', authenticateToken, async (req, res) => {
  try {
    if (!verifyUserOwnershipOrAdmin(req, req.params.id)) {
      return res.status(403).json({ error: 'Unauthorized: You can only edit your own profile' });
    }

    const { rows } = await pool.query('SELECT * FROM students WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    if (rows[0].batch_id !== req.user.batch_id) return res.status(403).json({ error: 'Unauthorized: Student not in your batch' });
    const s = rowToStudent(rows[0]);

    const { name, level, description, domain, avatar, github, linkedin, x_account } = req.body || {};
    const now = Date.now();

    if (typeof name === 'string' && name.trim()) s.name = name.trim().slice(0, 60);
    if (typeof description === 'string') s.description = description.slice(0, 240);
    if (typeof domain === 'string') s.domain = domain.slice(0, 60);
    if (typeof github === 'string') s.github = github.slice(0, 255);
    if (typeof linkedin === 'string') s.linkedin = linkedin.slice(0, 255);
    if (typeof x_account === 'string') s.x_account = x_account.slice(0, 255);
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
           github = $6, linkedin = $7, x_account = $8,
           last_updated = $9, last_level_up_at = $10, history = $11
       WHERE id = $12`,
      [
        s.name, s.level, s.description, s.domain, s.avatar,
        s.github, s.linkedin, s.x_account,
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
app.post('/api/students/:id/bump', authenticateToken, async (req, res) => {
  try {
    if (!verifyUserOwnershipOrAdmin(req, req.params.id)) {
      return res.status(403).json({ error: 'Unauthorized: You can only edit your own profile' });
    }

    const { rows } = await pool.query('SELECT * FROM students WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    if (rows[0].batch_id !== req.user.batch_id) return res.status(403).json({ error: 'Unauthorized: Student not in your batch' });
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
app.delete('/api/students/:id', authenticateToken, async (req, res) => {
  try {
    if (!verifyUserOwnershipOrAdmin(req, req.params.id)) {
      return res.status(403).json({ error: 'Unauthorized: You can only delete your own profile' });
    }

    const { rows } = await pool.query('SELECT batch_id FROM students WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    if (rows[0].batch_id !== req.user.batch_id) return res.status(403).json({ error: 'Unauthorized: Student not in your batch' });

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

// --- SOCKET.IO ---
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication error'));
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return next(new Error('Authentication error'));
    socket.user = user;
    next();
  });
});

io.on('connection', (socket) => {
  const user = socket.user;
  if (!user.batch_id) {
    socket.disconnect();
    return;
  }

  // Join the user's specific batch room
  socket.join(`batch_${user.batch_id}`);
  // Join the user's personal room for direct messages
  socket.join(`user_${user.id}`);


  // Fetch recent messages
  socket.on('fetch_messages', async (data) => {
    try {
      const { rows } = await pool.query(
        `SELECT m.* 
         FROM messages m
         LEFT JOIN hidden_messages hm ON hm.message_id = m.id AND hm.user_id = $1
         LEFT JOIN chat_clears cc ON cc.user_id = $1 AND (
           (m.receiver_id IS NULL AND cc.room_id = 'group') OR
           (m.receiver_id IS NOT NULL AND cc.room_id = 'dm_' || CASE WHEN m.sender_id = $1 THEN m.receiver_id ELSE m.sender_id END)
         )
         WHERE m.batch_id = $2 
           AND m.created_at > $3
           AND hm.message_id IS NULL
           AND (cc.cleared_at IS NULL OR m.created_at > cc.cleared_at)
         ORDER BY m.created_at ASC`, 
        [user.id, user.batch_id, Date.now() - 86400000]
      );
      // Filter out DMs not meant for this user
      const visible = rows.filter(m => !m.receiver_id || m.receiver_id === user.id || m.sender_id === user.id);
      socket.emit('recent_messages', visible);
    } catch(err) {
      console.error('Socket DB error', err);
    }
  });



  socket.on('mark_delivered', async ({ ids }) => {
     if (!ids || !ids.length) return;
     try {
       await pool.query(`UPDATE messages SET read_status = 'delivered' WHERE id = ANY($1) AND receiver_id = $2 AND read_status = 'sent'`, [ids, user.id]);
       io.to(`batch_${user.batch_id}`).emit('messages_status_update', { ids, status: 'delivered' });
     } catch(e) {}
  });

  socket.on('mark_read', async ({ ids }) => {
     if (!ids || !ids.length) return;
     try {
       await pool.query(`UPDATE messages SET read_status = 'read' WHERE id = ANY($1) AND receiver_id = $2 AND read_status IN ('sent', 'delivered')`, [ids, user.id]);
       io.to(`batch_${user.batch_id}`).emit('messages_status_update', { ids, status: 'read' });
     } catch(e) {}
  });

  socket.on('hide_message', async ({ id }) => {
    try {
      await pool.query(`INSERT INTO hidden_messages (user_id, message_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [user.id, id]);
    } catch(e) {}
  });

  socket.on('clear_chat', async ({ isGroup, other_id }) => {
    try {
      const room_id = isGroup ? 'group' : `dm_${other_id}`;
      await pool.query(`
        INSERT INTO chat_clears (user_id, room_id, cleared_at) 
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id, room_id) DO UPDATE SET cleared_at = EXCLUDED.cleared_at
      `, [user.id, room_id, Date.now()]);
    } catch(e) {}
  });

  socket.on('edit_message', async (data) => {
    try {
      const { id, content } = data;
      if (!id || !content || !content.trim()) return;
      const result = await pool.query(
        `UPDATE messages SET content = $1, is_edited = true WHERE id = $2 AND sender_id = $3 RETURNING *`,
        [content.trim(), id, user.id]
      );
      if (result.rowCount > 0) {
        const updatedMsg = result.rows[0];
        if (updatedMsg.receiver_id) {
          io.to(`user_${updatedMsg.receiver_id}`).emit('message_edited', updatedMsg);
          io.to(`user_${updatedMsg.sender_id}`).emit('message_edited', updatedMsg);
        } else {
          io.to(`batch_${user.batch_id}`).emit('message_edited', updatedMsg);
        }
      }
    } catch(err) { console.error('Edit error', err); }
  });

  socket.on('delete_message', async (data) => {
    try {
      const { id } = data;
      if (!id) return;
      
      const check = await pool.query(`SELECT * FROM messages WHERE id = $1 AND sender_id = $2`, [id, user.id]);
      if (check.rowCount > 0) {
        const msg = check.rows[0];
        await pool.query(`DELETE FROM messages WHERE id = $1`, [id]);
        if (msg.receiver_id) {
          io.to(`user_${msg.receiver_id}`).emit('message_deleted', { id });
          io.to(`user_${msg.sender_id}`).emit('message_deleted', { id });
        } else {
          io.to(`batch_${user.batch_id}`).emit('message_deleted', { id });
        }
      }
    } catch(err) { console.error('Delete error', err); }
  });

  // Handle new message


  socket.on('send_message', async (data) => {
    try {
      const { content, receiver_id } = data;
      if (!content || !content.trim()) return;
      
      const now = Date.now();
      const result = await pool.query(
        `INSERT INTO messages (sender_id, receiver_id, batch_id, content, created_at)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [user.id, receiver_id || null, user.batch_id, content.trim(), now]
      );
      
      const msg = result.rows[0];
      
      if (receiver_id) {
        io.to(`user_${receiver_id}`).emit('new_message', msg);
        io.to(`user_${user.id}`).emit('new_message', msg);
      } else {
        io.to(`batch_${user.batch_id}`).emit('new_message', msg);
      }

      // Cleanup 24h
      pool.query(`DELETE FROM messages WHERE created_at < $1`, [now - 86400000]).catch(console.error);
      
      // Cleanup 100 limit
      const room_condition = receiver_id ? `batch_id = $1 AND ((sender_id = $2 AND receiver_id = $3) OR (sender_id = $3 AND receiver_id = $2))` : `batch_id = $1 AND receiver_id IS NULL`;
      const room_args = receiver_id ? [user.batch_id, user.id, receiver_id] : [user.batch_id];
      pool.query(`
        DELETE FROM messages WHERE id IN (
          SELECT id FROM messages WHERE ${room_condition} ORDER BY created_at DESC OFFSET 100
        )
      `, room_args).catch(console.error);

    } catch(err) {
      console.error('Socket Send DB error', err);
    }
  });
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
      ALTER TABLE students ADD COLUMN IF NOT EXISTS batch_id TEXT;
      ALTER TABLE students ADD COLUMN IF NOT EXISTS batch_status TEXT;
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
        created_at      BIGINT NOT NULL
      );
      

      ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_edited BOOLEAN DEFAULT false;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_status TEXT DEFAULT 'sent';
      
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
    `);
    
    // Auto-cleanup ephemeral messages older than 24 hours (86400000 ms)
    await pool.query(`DELETE FROM messages WHERE created_at < $1`, [Date.now() - 86400000]);
    console.log('✓ Database schema verified/initialized (students table & index ready).');
  } catch (err) {
    console.warn('Note on DB init check:', err.message);
  }
}

httpServer.listen(PORT, () => {
  console.log(`Rank Board running at http://localhost:${PORT}`);
  initDb();
});

