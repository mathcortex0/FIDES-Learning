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

/* ─── SITE FOOTER (auto-injected into <footer id="siteFooter">) ─── */
function renderSiteFooter() {
  const el = document.getElementById('siteFooter');
  if (!el) return;
  const year = new Date().getFullYear();
  el.innerHTML = `
    <div class="site-footer-inner">
      <div class="sf-col">
        <div class="sf-brand"><img src="/images/fl.png" alt="FIDES Learning"><span>FIDES Learning</span></div>
        <p class="sf-tagline">A structured, distraction-free home for your courses — built for people who take learning seriously.</p>
      </div>
      <div class="sf-col">
        <h4>Platform</h4>
        <a href="/dashboard.html">Dashboard</a>
        <a href="/index.html">Overview</a>
      </div>
      <div class="sf-col">
        <h4>Support</h4>
        <a href="mailto:support@fideslearning.com">Contact Support</a>
        <a href="#">Help Center</a>
      </div>
      <div class="sf-col">
        <h4>Legal</h4>
        <a href="#">Privacy Policy</a>
        <a href="#">Terms of Service</a>
      </div>
    </div>
    <div class="site-footer-bottom">
      <span>&copy; ${year} FIDES Learning. All rights reserved.</span>
      <div class="sf-social">
        <a href="#" aria-label="Twitter"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg></a>
        <a href="#" aria-label="LinkedIn"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.38-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.07 2.07 0 110-4.14 2.07 2.07 0 010 4.14zM7.12 20.45H3.56V9h3.56v11.45z"/></svg></a>
        <a href="#" aria-label="GitHub"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/></svg></a>
      </div>
    </div>`;
}
document.addEventListener('DOMContentLoaded', renderSiteFooter);

/* ─── SVG ICON HELPERS (no emoji, ever) ─────────────────── */
function bookIconSvg(size) {
  size = size || 22;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>`;
}

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
