# Rank Board — Postgres/Supabase edition

Same gamified 52-level student board as before, but the storage layer is now
a real hosted Postgres database (via Supabase) instead of a JSON file on
disk. Nothing about the frontend changed — `public/` is byte-for-byte the
same as your original zip.

## 1. Create the free Supabase database (~3 minutes)

1. Go to https://supabase.com → sign in → **New project**. Pick any name,
   set a database password (save it, you'll need it below), pick a region
   close to you, free tier is fine.
2. Once it's provisioned: **Project Settings → Database → Connection string
   → URI**. Copy it — it looks like:
   `postgresql://postgres:[YOUR-PASSWORD]@db.xxxxxxxx.supabase.co:5432/postgres`
3. In the left sidebar, open **SQL Editor → New query**, paste the contents
   of `schema.sql` from this project, and click **Run**. This creates the
   `students` table.

## 2. Run it locally

Requires Node.js 18+.

```bash
npm install
cp .env.example .env
# edit .env and paste your real connection string into DATABASE_URL
npm start
```

Open http://localhost:3000 — it's now reading and writing straight to
Supabase. Your data survives restarts, redeploys, and crashes, because it's
no longer sitting on the app's own disk.

**Got existing data in the old `data/students.json`?** Drop that file into
`./data/students.json` in this project and run `npm run migrate` once —
it upserts everything into Postgres by id, so it's safe to re-run.

## 3. Why this actually removes the "losing data" risk

- The JSON-file version stored data on the app server's own disk. On free
  hosting tiers (Render free, most PaaS free tiers) that disk is
  **ephemeral** — a redeploy, restart, or the container being recycled
  wipes it. That was the risk.
- Supabase's Postgres is a separate, persistent, managed service with its
  own daily backups (7-day point-in-time recovery on the free tier at time
  of writing — worth double-checking current limits on their pricing page
  since these change). Your app server can restart, crash, redeploy, or be
  swapped for a different host entirely, and the data is untouched because
  it never lived there.
- The `/api/export` button in the app still works and now doubles as a
  belt-and-braces manual backup on top of Supabase's own backups.

## 4. Hosting the app itself for free

The database is already hosted (Supabase). You still need somewhere to run
the small Express server that talks to it. Two solid free options:

### Option A — Render (easiest, gives you a public https:// link)

1. Push this project to a GitHub repo (or upload the folder directly in
   Render's dashboard).
2. On https://render.com: **New → Web Service** → connect the repo.
3. Settings:
   - Build command: `npm install`
   - Start command: `npm start`
   - Instance type: **Free**
4. Add your environment variable: service → **Environment** → **Add
   Environment Variable** → key `DATABASE_URL`, value your Supabase
   connection string (the same one from `.env`). Don't commit `.env` to
   GitHub — it's already in `.gitignore`.
5. Deploy. You get a URL like `https://rank-board.onrender.com`.

One quirk of Render's free tier: the service **spins down after 15 minutes
of no traffic** and takes ~30-50s to wake back up on the next request. That
no longer risks your data (it's in Supabase), it just means the first
visitor after a lull waits a bit. If that's annoying, either upgrade to a
paid instance, or ping `/api/health` every 10 minutes with a free cron
service like https://cron-job.org or https://uptimerobot.com to keep it
warm.

### Option B — your own box + DuckDNS (free hostname, you run the process)

DuckDNS gives you a free hostname pointing at your own server's IP — you
still need something running this app 24/7 (a home PC, a Raspberry Pi, or a
small VPS).

1. On the machine that stays on: install Node.js 18+, copy this project
   over, `npm install`, add your `.env` with `DATABASE_URL`.
2. Set up DuckDNS (https://www.duckdns.org): create a subdomain (e.g.
   `myclass.duckdns.org`) — it gives you a token and an updater script to
   keep it pointed at your IP (needed if your ISP doesn't give you a static
   one).
3. Forward port 80/443 on your router to this machine's port 3000, or —
   easier and gets you free automatic HTTPS — run it behind **Caddy**:
   ```
   myclass.duckdns.org {
     reverse_proxy localhost:3000
   }
   ```
4. Keep the Node process alive across reboots with `pm2`:
   ```bash
   npm install -g pm2
   pm2 start server.js --name rank-board
   pm2 save
   pm2 startup
   ```

Here the database being external matters even more than in Option A: if
this home PC ever dies, gets reformatted, or the SD card in a Raspberry Pi
corrupts (common failure mode), you lose nothing — just point a fresh
install of this same app at the same `DATABASE_URL` and you're back.

### Other free-tier options worth knowing about

- **Railway** — similar flow to Render, free usage-based tier with monthly
  credit rather than a fixed free plan; also spins down on inactivity on
  the free tier.
- **Fly.io** — free allowance for small always-on VMs, good if you want to
  avoid the Render spin-down without paying, but has a slightly steeper
  CLI-based deploy flow.
- **Cyclic / Glitch** — simplest possible free Node hosting for a project
  this size, worth trying if Render's spin-down bothers you and Fly.io
  feels like overkill.

Whichever you pick, the only thing that changes is where the Express
server runs — `DATABASE_URL` is the one setting that has to travel with it.

## How the "streak" visuals work (unchanged from before)

- Every student stores `last_level_up_at` — the last time their level
  changed.
- The server computes `weeksStale` (full weeks since that timestamp) and
  `justLeveledUp` (changed within the last 48h) and sends them with every
  student.
- The milestone track uses `weeksStale` to sink a profile down a little for
  each stale week (capped), and plays a snap-back animation with a 🚀 the
  moment a level change arrives. Emoji states: 🚀 just leveled up, 🙂
  active this week, 😐 1 week stale, 😴 2 weeks stale, ⚠️ 3+ weeks stale.
- The board polls the server every 30 seconds so multiple viewers stay
  roughly in sync.

## What I'd extend next

1. **Auth** — right now anyone with the URL can add/edit/delete students.
   Add a simple teacher login (Supabase Auth is free and drops in easily
   since you're already on Supabase) before sharing the link widely.
2. **Move avatars out of the database** — avatars are currently stored as
   base64 text inside the `avatar` column, which bloats row size fast.
   Supabase Storage (free tier, 1GB) is a better fit: upload the image
   there, store just the resulting URL in the `avatar` column.
3. **Audit trail** — you already keep a `history` array per student; a
   small "recent activity" feed across all students (who leveled up when)
   would reuse that data and add almost no new backend work.
4. **Connection pooling for serverless** — if you ever move the app server
   itself to a serverless host (Vercel functions, etc.), switch
   `DATABASE_URL` to Supabase's pooled connection string (port 6543,
   "Transaction" mode) — the direct one (5432) can exhaust connections
   under serverless's connect-per-request pattern.
