// End-to-end API test using Node's built-in test runner. Run: npm test
process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('./server');

let server, base;
test.before(async () => {
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const call = async (method, path, body, token) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

test('full flow', async () => {
  assert.equal((await call('GET', '/api/health')).status, 200);

  // validation
  assert.equal((await call('POST', '/api/auth/register', { email: 'bad', password: 'password123' })).status, 400);
  assert.equal((await call('POST', '/api/auth/register', { email: 'a@b.com', password: 'short' })).status, 400);

  // register + duplicate + login
  const reg = await call('POST', '/api/auth/register', { email: 'Alice@Example.com', password: 'password123' });
  assert.equal(reg.status, 201);
  assert.equal(reg.body.user.email, 'alice@example.com');
  assert.equal((await call('POST', '/api/auth/register', { email: 'alice@example.com', password: 'password123' })).status, 409);
  assert.equal((await call('POST', '/api/auth/login', { email: 'alice@example.com', password: 'wrongpass' })).status, 401);
  const login = await call('POST', '/api/auth/login', { email: 'alice@example.com', password: 'password123' });
  assert.equal(login.status, 200);
  const token = login.body.token;

  // auth required
  assert.equal((await call('GET', '/api/tasks')).status, 401);

  // create tasks
  assert.equal((await call('POST', '/api/tasks', { title: '' }, token)).status, 400);
  const t1 = await call('POST', '/api/tasks', { title: 'Write report', priority: 'high', due_date: '2020-01-01' }, token);
  assert.equal(t1.status, 201);
  assert.equal(t1.body.done, false);
  const t2 = await call('POST', '/api/tasks', { title: 'Email mentor', notes: 'Ask about review' }, token);
  assert.equal(t2.body.priority, 'medium');

  // list ordering: high priority first
  const list = await call('GET', '/api/tasks', null, token);
  assert.equal(list.body.length, 2);
  assert.equal(list.body[0].title, 'Write report');

  // update + filters + stats
  const upd = await call('PATCH', `/api/tasks/${t2.body.id}`, { done: true }, token);
  assert.equal(upd.body.done, true);
  assert.equal((await call('GET', '/api/tasks?filter=completed', null, token)).body.length, 1);
  assert.equal((await call('GET', '/api/tasks?filter=active', null, token)).body.length, 1);
  const stats = await call('GET', '/api/stats', null, token);
  assert.deepEqual(stats.body, { total: 2, completed: 1, overdue: 1 });

  // isolation between users
  const bob = (await call('POST', '/api/auth/register', { email: 'bob@example.com', password: 'password123' })).body.token;
  assert.equal((await call('GET', '/api/tasks', null, bob)).body.length, 0);
  assert.equal((await call('PATCH', `/api/tasks/${t1.body.id}`, { done: true }, bob)).status, 404);
  assert.equal((await call('DELETE', `/api/tasks/${t1.body.id}`, null, bob)).status, 404);

  // delete
  assert.equal((await call('DELETE', `/api/tasks/${t1.body.id}`, null, token)).status, 204);
  assert.equal((await call('GET', '/api/tasks', null, token)).body.length, 1);
});
