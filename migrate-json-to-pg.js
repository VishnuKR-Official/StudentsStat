// One-time helper: imports data/students.json (the old flat-file store)
// into your new Postgres/Supabase database. Safe to run more than once —
// it upserts by id, so re-running just re-syncs the same rows.
//
// Usage:
//   1. Put your old students.json at ./data/students.json (or pass a path
//      as the first CLI argument).
//   2. Make sure .env has DATABASE_URL set.
//   3. npm run migrate

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const filePath = process.argv[2] || path.join(__dirname, 'data', 'students.json');

if (!fs.existsSync(filePath)) {
  console.log(`No file found at ${filePath} — nothing to migrate. Skipping.`);
  process.exit(0);
}

const raw = fs.readFileSync(filePath, 'utf8').trim();
const students = raw ? JSON.parse(raw) : [];

if (!Array.isArray(students) || students.length === 0) {
  console.log('File is empty — nothing to migrate.');
  process.exit(0);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

(async () => {
  console.log(`Migrating ${students.length} student(s)...`);
  for (const d of students) {
    const now = Date.now();
    await pool.query(
      `INSERT INTO students
        (id, name, level, description, avatar, created_at, last_updated, last_level_up_at, history)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         name=EXCLUDED.name, level=EXCLUDED.level, description=EXCLUDED.description,
         avatar=EXCLUDED.avatar, last_updated=EXCLUDED.last_updated,
         last_level_up_at=EXCLUDED.last_level_up_at, history=EXCLUDED.history`,
      [
        d.id, d.name, d.level, d.description || '', d.avatar || null,
        d.createdAt || now, d.lastUpdated || now, d.lastLevelUpAt || d.lastUpdated || now,
        JSON.stringify(d.history || []),
      ]
    );
    console.log(`  ✓ ${d.name}`);
  }
  console.log('Done. Verify with: SELECT count(*) FROM students; in the Supabase SQL editor.');
  await pool.end();
})().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
