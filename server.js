const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'taskflow.db');
// In production set JWT_SECRET; otherwise a random one is generated per boot.
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
    due_date TEXT,
    done INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);
`);

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 50, standardHeaders: true, legacyHeaders: false });

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

const sign = (user) => jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
const emailOk = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.post('/api/auth/register', authLimiter, (req, res) => {
  const { email, password } = req.body || {};
  if (!emailOk(email)) return res.status(400).json({ error: 'Valid email required' });
  if (typeof password !== 'string' || password.length < 8 || password.length > 128)
    return res.status(400).json({ error: 'Password must be 8-128 characters' });
  const normalized = email.trim().toLowerCase();
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(normalized))
    return res.status(409).json({ error: 'Email already registered' });
  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(normalized, hash);
  const user = { id: Number(info.lastInsertRowid), email: normalized };
  res.status(201).json({ token: sign(user), user });
});

app.post('/api/auth/login', authLimiter, (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string')
    return res.status(400).json({ error: 'Email and password required' });
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (!row || !bcrypt.compareSync(password, row.password_hash))
    return res.status(401).json({ error: 'Invalid email or password' });
  const user = { id: Number(row.id), email: row.email };
  res.json({ token: sign(user), user });
});

const toTask = (r) => ({ ...r, id: Number(r.id), user_id: Number(r.user_id), done: !!r.done });

function validateTask(body, partial = false) {
  const out = {};
  if (!partial || body.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 200)
      return { error: 'Title required (max 200 chars)' };
    out.title = body.title.trim();
  }
  if (body.notes !== undefined) {
    if (typeof body.notes !== 'string' || body.notes.length > 2000) return { error: 'Notes max 2000 chars' };
    out.notes = body.notes;
  }
  if (body.priority !== undefined) {
    if (!['low', 'medium', 'high'].includes(body.priority)) return { error: 'Priority must be low, medium or high' };
    out.priority = body.priority;
  }
  if (body.due_date !== undefined) {
    if (body.due_date !== null && body.due_date !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(body.due_date))
      return { error: 'due_date must be YYYY-MM-DD' };
    out.due_date = body.due_date || null;
  }
  if (body.done !== undefined) out.done = body.done ? 1 : 0;
  return { value: out };
}

app.get('/api/tasks', auth, (req, res) => {
  const filter = req.query.filter;
  let sql = 'SELECT * FROM tasks WHERE user_id = ?';
  if (filter === 'active') sql += ' AND done = 0';
  else if (filter === 'completed') sql += ' AND done = 1';
  sql += " ORDER BY done ASC, CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, due_date IS NULL, due_date, id DESC";
  res.json(db.prepare(sql).all(req.user.id).map(toTask));
});

app.post('/api/tasks', auth, (req, res) => {
  const { error, value } = validateTask(req.body || {});
  if (error) return res.status(400).json({ error });
  const info = db
    .prepare('INSERT INTO tasks (user_id, title, notes, priority, due_date) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.id, value.title, value.notes || '', value.priority || 'medium', value.due_date || null);
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(toTask(row));
});

app.patch('/api/tasks/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Task not found' });
  const { error, value } = validateTask(req.body || {}, true);
  if (error) return res.status(400).json({ error });
  const keys = Object.keys(value);
  if (keys.length) {
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    db.prepare(`UPDATE tasks SET ${sets} WHERE id = ?`).run(...keys.map((k) => value[k]), id);
  }
  res.json(toTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)));
});

app.delete('/api/tasks/:id', auth, (req, res) => {
  const info = db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
  if (!info.changes) return res.status(404).json({ error: 'Task not found' });
  res.status(204).end();
});

app.get('/api/stats', auth, (req, res) => {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(done), 0) AS completed,
              COALESCE(SUM(CASE WHEN done = 0 AND due_date IS NOT NULL AND due_date < date('now') THEN 1 ELSE 0 END), 0) AS overdue
       FROM tasks WHERE user_id = ?`
    )
    .get(req.user.id);
  res.json({ total: Number(r.total), completed: Number(r.completed), overdue: Number(r.overdue) });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Server error' });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`TaskFlow running on port ${PORT}`));
}
module.exports = app;
