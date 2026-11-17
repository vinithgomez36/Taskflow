# TaskFlow

A full-stack task manager built for an internship project.

**Features:** user sign-up and login (JWT, bcrypt-hashed passwords), personal task lists with priority, due dates and notes, filters (all / active / completed), live stats (total, completed, overdue), responsive UI.

**Stack:** Node.js 22, Express, SQLite (`node:sqlite`), vanilla JavaScript frontend. Security: helmet (CSP), rate-limited auth routes, input validation, per-user data isolation.

## Run locally

```bash
npm install
npm start          # http://localhost:3000
npm test           # end-to-end API test
```

Requires Node 22.13 or newer. Copy `.env.example` to `.env` if you want to set `JWT_SECRET` yourself.

## API

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register` | `{email, password}` returns `{token, user}` |
| POST | `/api/auth/login` | `{email, password}` returns `{token, user}` |
| GET | `/api/tasks?filter=all\|active\|completed` | List your tasks |
| POST | `/api/tasks` | `{title, notes?, priority?, due_date?}` |
| PATCH | `/api/tasks/:id` | Update any task field, including `done` |
| DELETE | `/api/tasks/:id` | Delete a task |
| GET | `/api/stats` | `{total, completed, overdue}` |
| GET | `/api/health` | Health check |

Send the token as `Authorization: Bearer <token>`.

## Deploy free on Render

1. Create a GitHub repository and push this folder:
   ```bash
   git init && git add . && git commit -m "TaskFlow"
   git branch -M main
   git remote add origin https://github.com/<you>/taskflow.git
   git push -u origin main
   ```
2. Go to [render.com](https://render.com), sign in with GitHub, then **New → Blueprint** and pick the repo. Render reads `render.yaml`, builds and starts the app, and generates a `JWT_SECRET` for you.
3. After the build finishes you get a live URL such as `https://taskflow-xxxx.onrender.com`.

Without Blueprints: **New → Web Service**, build command `npm install`, start command `npm start`, and add env vars `NODE_VERSION=22.14.0` and `JWT_SECRET=<long random string>`.

### Free-tier notes

- The service sleeps after ~15 minutes idle, so the first request after a pause takes about 30-60 seconds.
- The free disk is **ephemeral**: the SQLite file resets on each redeploy or restart. That is fine for a demo. For permanent data, move to a hosted database (Render Postgres, Neon or Supabase) or attach a paid persistent disk and set `DB_PATH` to its mount path.

## Project structure

```
server.js        Express app, API routes, SQLite schema
test.js          End-to-end API test
public/          Frontend (index.html, styles.css, app.js)
render.yaml      Render deployment blueprint
```
