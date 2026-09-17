# 🚀 Student Rank Board — 52 Level Skill Tracker

[![Live App](https://img.shields.io/badge/Live%20App-studentsstat.onrender.com-brightgreen?style=for-the-badge&logo=render)](https://studentsstat.onrender.com)
[![Database](https://img.shields.io/badge/Database-Supabase%20Postgres-blue?style=for-the-badge&logo=supabase)](https://supabase.com)
[![Node.js](https://img.shields.io/badge/Backend-Node.js%20%2B%20Express-green?style=for-the-badge&logo=nodedotjs)](https://nodejs.org)

> **Vibe-coded for our student batch!** A gamified 52-level leaderboard designed to spark healthy peer pressure, track learning momentum, and stay aligned on weekly progress without the endless check-ins.

---

## 🎯 Why This App Was Created

Instead of constantly asking classmates:
- *"Hey, which module are you currently in?"*
- *"What are you studying this week?"*
- *"Where are we on the learning roadmap?"*

This app eliminates all that confusion! It gives our entire batch a single, shared rank board where everyone can:
1. **See Everyone's Level**: Track where each friend stands across **52 skill levels**.
2. **View Current Topics**: Hover or click any profile to see what specific chapter, module, or topic they are currently studying.
3. **Healthy Peer Pressure**: Friendly competition that motivates everyone to stay active and level up continuously.

---

## ✨ Features

- **🎮 52 Gamified Levels**: Track progress step-by-step from Level 1 all the way to Level 52.
- **📈 Dynamic Milestone Track**: 
  - 🚀 **Rocket**: Just leveled up in the past 48 hours!
  - 🙂 **Active**: Updated level this week.
  - 😐 / 😴 / ⚠️ **Stale Indicators**: Sinks down slightly if inactive for 1+ weeks to encourage momentum.
- **⚡ Real-Time Cloud Sync**: Powered by a hosted **Supabase PostgreSQL** database, so student data survives server restarts and redeploys.
- **💾 Export & Backup**: Download a local JSON snapshot of the entire leaderboard anytime.

---

## 🛠️ Tech Stack

- **Frontend**: Pure HTML5, CSS3, Vanilla JavaScript.
- **Backend**: Node.js + Express.js.
- **Database**: PostgreSQL hosted on [Supabase](https://supabase.com).
- **Hosting**: Hosted for free on [Render.com](https://render.com).

---

## 💻 Local Setup & Development

If you want to run this board on your own computer:

1. **Clone the repository**:
   ```bash
   git clone https://github.com/VishnuKR-Official/StudentsStat.git
   cd StudentsStat
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   Copy `.env.example` to `.env` and fill in your Supabase Postgres `DATABASE_URL`:
   ```env
   DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
   PORT=3000
   ```

4. **Start the server**:
   ```bash
   npm start
   ```
   Open `http://localhost:3000` in your browser.

---

*Built with ❤️ for our batch to level up together!*
