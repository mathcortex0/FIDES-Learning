/* ============================================================
   FIDES Learning — common.js
   Shared helpers used across every page: API calls, auth,
   toasts, modals, and small render utilities.
   ============================================================ */

const API_BASE = '/api';
const TOKEN_KEY = 'fides_token';
const USER_KEY = 'fides_user';

/* ─── AUTH STORAGE ───────────────────────────────────────── */
function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
function getUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch (e) { return null; }
}
function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

/* ─── API WRAPPER ────────────────────────────────────────── */
async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch (networkErr) {
    throw new Error('Network error — check your connection and try again.');
  }

  let data = {};
  try { data = await res.json(); } catch (e) { /* empty body is fine */ }

  if (res.status === 401 && auth) {
    clearSession();
    if (!location.pathname.endsWith('admin.html') && !location.pathname.endsWith('index.html')) {
      location.href = '/index.html';
    }
  }

  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/* ─── TOASTS ─────────────────────────────────────────────── */
function toast(message, type = 'info', ms = 3500) {
  let root = document.getElementById('toastRoot');
  if (!root) {
    root = document.createElement('div');
    root.id = 'toastRoot';
    root.className = 'toast-container';
    document.body.appendChild(root);
  }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = message;
  root.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 250);
  }, ms);
}

/* ─── MODAL ──────────────────────────────────────────────── */
function openModal(innerHtml) {
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'activeModal';
  overlay.innerHTML = `<div class="modal">${innerHtml}</div>`;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  return overlay;
}
function closeModal() {
  const existing = document.getElementById('activeModal');
  if (existing) existing.remove();
}

/* ─── SMALL RENDER HELPERS ───────────────────────────────── */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (isNaN(d)) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function renderTable({ headers, rows, empty }) {
  if (!rows.length) {
    return `<div class="empty">${escapeHtml(empty || 'Nothing here yet.')}</div>`;
  }
  const head = headers.map(h => `<th>${escapeHtml(h)}</th>`).join('');
  const body = rows.map(r =>
    `<tr>${r.map((cell, i) => `<td data-label="${escapeHtml(headers[i])}">${cell}</td>`).join('')}</tr>`
  ).join('');
  return `<div class="table-wrap"><table class="table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function loadingRow(label = 'Loading…') {
  return `<div class="loading-row"><span class="spinner"></span>${escapeHtml(label)}</div>`;
}

/* ─── AUTH GUARD (call at top of any protected page) ────── */
async function requireAdmin() {
  const token = getToken();
  if (!token) { location.href = '/index.html'; return null; }
  try {
    const { user } = await api('/user/me');
    if (user.role !== 'admin') { location.href = '/dashboard.html'; return null; }
    return user;
  } catch (e) {
    clearSession();
    location.href = '/index.html';
    return null;
  }
}

/* ─── LOCAL PREFERENCE HELPERS (remember last picks) ────── */
function rememberPick(key, value) { localStorage.setItem('fides_pick_' + key, value); }
function recallPick(key) { return localStorage.getItem('fides_pick_' + key) || ''; }

/* ─── NOTIFICATION BELL (call once per page: initNotifBell()) ─ */
let _notifPollTimer = null;
async function initNotifBell() {
  const btn = document.getElementById('notifBell');
  if (!btn) return;
  btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg><span id="notifBadge" class="notif-badge hidden">0</span>`;
  btn.parentElement.classList.add('notif-wrap');
  const dropdown = document.createElement('div');
  dropdown.className = 'notif-dropdown';
  dropdown.id = 'notifDropdown';
  btn.parentElement.appendChild(dropdown);

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const isOpen = dropdown.classList.contains('open');
    if (isOpen) { dropdown.classList.remove('open'); return; }
    dropdown.classList.add('open');
    await loadNotifDropdown(dropdown);
    try { await api('/user/notifications/read', { method: 'PUT' }); } catch (e) {}
    updateNotifBadge(0);
  });
  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target) && e.target !== btn) dropdown.classList.remove('open');
  });

  await pollNotifCount();
  _notifPollTimer = setInterval(pollNotifCount, 30000);
}

async function pollNotifCount() {
  try {
    const { count } = await api('/user/notifications/unread-count');
    updateNotifBadge(count);
  } catch (e) { /* not logged in yet, ignore */ }
}

function updateNotifBadge(count) {
  const badge = document.getElementById('notifBadge');
  if (!badge) return;
  badge.textContent = count > 9 ? '9+' : String(count);
  badge.classList.toggle('hidden', !count);
}

async function loadNotifDropdown(dropdown) {
  dropdown.innerHTML = `<div class="notif-dropdown-head">Notifications</div><div class="loading-row"><span class="spinner"></span></div>`;
  try {
    const { notifications } = await api('/user/notifications');
    const body = notifications.length
      ? notifications.map(n => `
          <div class="notif-item">
            <div class="notif-item-title">${escapeHtml(n.title)}</div>
            <div class="notif-item-msg">${escapeHtml(n.message)}</div>
            <div class="notif-item-date">${formatDate(n.created_at)}</div>
          </div>`).join('')
      : `<div class="empty" style="padding:24px 16px">No notifications yet.</div>`;
    dropdown.innerHTML = `<div class="notif-dropdown-head">Notifications</div>${body}`;
  } catch (e) {
    dropdown.innerHTML = `<div class="notif-dropdown-head">Notifications</div><div class="empty" style="padding:24px 16px">${escapeHtml(e.message)}</div>`;
  }
}
