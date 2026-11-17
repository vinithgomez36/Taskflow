(() => {
  const $ = (id) => document.getElementById(id);
  const state = { token: null, user: null, mode: 'login', filter: 'all' };

  try {
    state.token = localStorage.getItem('tf_token');
    state.user = JSON.parse(localStorage.getItem('tf_user') || 'null');
  } catch { /* storage unavailable */ }

  async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    const res = await fetch(`/api${path}`, { ...opts, headers });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && state.token) logout();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  function save() {
    try {
      if (state.token) {
        localStorage.setItem('tf_token', state.token);
        localStorage.setItem('tf_user', JSON.stringify(state.user));
      } else {
        localStorage.removeItem('tf_token');
        localStorage.removeItem('tf_user');
      }
    } catch { /* ignore */ }
  }

  function logout() {
    state.token = null;
    state.user = null;
    save();
    render();
  }

  function setMode(mode) {
    state.mode = mode;
    $('tabLogin').classList.toggle('active', mode === 'login');
    $('tabRegister').classList.toggle('active', mode === 'register');
    $('authSubmit').textContent = mode === 'login' ? 'Log in' : 'Create account';
    $('password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    $('authError').textContent = '';
  }

  function render() {
    const loggedIn = !!state.token;
    $('authView').classList.toggle('hidden', loggedIn);
    $('appView').classList.toggle('hidden', !loggedIn);
    $('userbox').classList.toggle('hidden', !loggedIn);
    if (loggedIn) {
      $('userEmail').textContent = state.user ? state.user.email : '';
      refresh();
    }
  }

  async function refresh() {
    try {
      const [tasks, stats] = await Promise.all([
        api(`/tasks?filter=${state.filter}`),
        api('/stats'),
      ]);
      $('statTotal').textContent = stats.total;
      $('statDone').textContent = stats.completed;
      $('statOverdue').textContent = stats.overdue;
      renderTasks(tasks);
    } catch (e) {
      $('taskError').textContent = e.message;
    }
  }

  function renderTasks(tasks) {
    const list = $('taskList');
    list.replaceChildren();
    $('empty').classList.toggle('hidden', tasks.length > 0);
    const today = new Date().toISOString().slice(0, 10);

    for (const t of tasks) {
      const li = document.createElement('li');
      li.className = `task ${t.priority}${t.done ? ' done' : ''}`;

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = t.done;
      cb.setAttribute('aria-label', `Mark "${t.title}" as ${t.done ? 'not done' : 'done'}`);
      cb.addEventListener('change', async () => {
        try { await api(`/tasks/${t.id}`, { method: 'PATCH', body: JSON.stringify({ done: cb.checked }) }); }
        catch (e) { $('taskError').textContent = e.message; }
        refresh();
      });

      const body = document.createElement('div');
      body.className = 'body';
      const title = document.createElement('div');
      title.className = 't';
      title.textContent = t.title;
      body.appendChild(title);
      if (t.notes) {
        const n = document.createElement('div');
        n.className = 'n';
        n.textContent = t.notes;
        body.appendChild(n);
      }
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.append(`${t.priority[0].toUpperCase()}${t.priority.slice(1)} priority`);
      if (t.due_date) {
        meta.append(' · ');
        const due = document.createElement('span');
        const late = !t.done && t.due_date < today;
        if (late) due.className = 'overdue';
        due.textContent = `${late ? 'Overdue: ' : 'Due '}${t.due_date}`;
        meta.appendChild(due);
      }
      body.appendChild(meta);

      const del = document.createElement('button');
      del.className = 'del';
      del.type = 'button';
      del.textContent = '×';
      del.setAttribute('aria-label', `Delete "${t.title}"`);
      del.addEventListener('click', async () => {
        try { await api(`/tasks/${t.id}`, { method: 'DELETE' }); }
        catch (e) { $('taskError').textContent = e.message; }
        refresh();
      });

      li.append(cb, body, del);
      list.appendChild(li);
    }
  }

  $('tabLogin').addEventListener('click', () => setMode('login'));
  $('tabRegister').addEventListener('click', () => setMode('register'));

  $('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('authError').textContent = '';
    const btn = $('authSubmit');
    btn.disabled = true;
    try {
      const data = await api(`/auth/${state.mode}`, {
        method: 'POST',
        body: JSON.stringify({ email: $('email').value, password: $('password').value }),
      });
      state.token = data.token;
      state.user = data.user;
      save();
      $('password').value = '';
      render();
    } catch (err) {
      $('authError').textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  $('taskForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('taskError').textContent = '';
    try {
      await api('/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: $('title').value,
          notes: $('notes').value,
          priority: $('priority').value,
          due_date: $('due').value || null,
        }),
      });
      $('title').value = '';
      $('notes').value = '';
      $('due').value = '';
      refresh();
    } catch (err) {
      $('taskError').textContent = err.message;
    }
  });

  document.querySelectorAll('.chip').forEach((chip) =>
    chip.addEventListener('click', () => {
      state.filter = chip.dataset.filter;
      document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === chip));
      refresh();
    })
  );

  $('logoutBtn').addEventListener('click', logout);
  render();
})();
