// ============================================================
// FIDES Learning — Complete Backend (schema auto-creates itself)
// functions/api/[[route]].js
// ============================================================

// ─── SCHEMA (runs itself — no separate wrangler d1 execute step) ──

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    salt TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'student',
    is_approved INTEGER NOT NULL DEFAULT 1,
    is_blocked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    thumbnail_url TEXT DEFAULT '',
    icon TEXT DEFAULT '',
    is_featured INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS subjects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS chapters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS lectures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chapter_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    youtube_id TEXT DEFAULT '',
    pdf_url TEXT DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    link_url TEXT DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS enrollments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    course_id INTEGER NOT NULL,
    enrolled_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
    UNIQUE(user_id, course_id)
  )`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    link TEXT DEFAULT '',
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    ip_address TEXT DEFAULT '',
    user_agent TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
  `CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)`,
  `CREATE INDEX IF NOT EXISTS idx_subjects_course ON subjects(course_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chapters_subject ON chapters(subject_id)`,
  `CREATE INDEX IF NOT EXISTS idx_lectures_chapter ON lectures(chapter_id)`,
  `CREATE INDEX IF NOT EXISTS idx_resources_course ON resources(course_id)`,
  `CREATE INDEX IF NOT EXISTS idx_enrollments_user ON enrollments(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_enrollments_course ON enrollments(course_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at)`
];

// Module-scope flag: the Worker isolate stays warm between requests, so this
// batch only actually runs once per cold start (rare) — not on every request.
// CREATE TABLE/INDEX IF NOT EXISTS is idempotent, so even a re-run is harmless.
let schemaReady = false;

async function ensureSchema(db) {
  if (schemaReady) return;
  const batch = SCHEMA_STATEMENTS.map(sql => db.prepare(sql));
  await db.batch(batch);
  schemaReady = true;
}

// ─── CONSTANTS ──────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

// ─── CRYPTO HELPERS ─────────────────────────────────────────

async function pbkdf2(password, salt, iterations = 100000, keyLen = 64) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: encoder.encode(salt), iterations, hash: 'SHA-256' },
    keyMaterial, keyLen * 8
  );
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256(key, data) {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return atob(str);
}

function generateSalt() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── JWT ────────────────────────────────────────────────────

async function signToken(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = btoa(JSON.stringify(header)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const payloadB64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const signature = await hmacSha256(secret, `${headerB64}.${payloadB64}`);
  return `${headerB64}.${payloadB64}.${signature}`;
}

async function verifyToken(token, secret) {
  try {
    const [headerB64, payloadB64, signature] = token.split('.');
    if (!headerB64 || !payloadB64 || !signature) return null;
    const expectedSig = await hmacSha256(secret, `${headerB64}.${payloadB64}`);
    if (signature !== expectedSig) return null;
    const payload = JSON.parse(base64UrlDecode(payloadB64));
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

// ─── HELPERS ────────────────────────────────────────────────

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}
function err(msg, status = 400) { return json({ error: msg }, status); }

async function getUser(request, secret) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '');
  if (!token) return null;
  return await verifyToken(token, secret);
}

function getIp(request) { return request.headers.get('CF-Connecting-IP') || ''; }
function getUa(request) { return request.headers.get('User-Agent') || ''; }

// ─── AUTH HANDLER ───────────────────────────────────────────

async function handleAuth(method, path, body, db, request, secret) {
  if (method === 'GET' && path === '/admin/setup-status') {
    const admin = await db.prepare('SELECT id FROM users WHERE role = ? LIMIT 1').bind('admin').first();
    return json({ hasAdmin: !!admin });
  }

  if (method === 'POST' && path === '/admin/setup') {
    const { name, email, password } = body || {};
    if (!name || !email || !password) return err('Name, email, and password are required.', 400);
    if (password.length < 6) return err('Password must be at least 6 characters.', 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err('Invalid email format.', 400);

    const existing = await db.prepare('SELECT id FROM users WHERE role = ? LIMIT 1').bind('admin').first();
    if (existing) return err('An admin account already exists. Please login.', 400);

    const salt = generateSalt();
    const hashedPw = await pbkdf2(password, salt);
    const result = await db.prepare(
      'INSERT INTO users (name, email, password, salt, role, is_approved) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(name.trim(), email.toLowerCase().trim(), hashedPw, salt, 'admin', 1).run();

    await db.prepare(
      'INSERT INTO audit_logs (user_id, action, ip_address, user_agent) VALUES (?, ?, ?, ?)'
    ).bind(result.meta.last_row_id, 'admin_account_created', getIp(request), getUa(request)).run();

    const token = await signToken({
      id: result.meta.last_row_id, email: email.toLowerCase().trim(), role: 'admin',
      exp: Date.now() + 30 * 24 * 60 * 60 * 1000
    }, secret);

    return json({
      token,
      user: { id: result.meta.last_row_id, name: name.trim(), email: email.toLowerCase().trim(), role: 'admin' }
    });
  }

  if (method === 'POST' && path === '/auth/register') {
    const { name, email, password } = body || {};
    if (!name || !email || !password) return err('Name, email, and password are required.', 400);
    if (password.length < 6) return err('Password must be at least 6 characters.', 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err('Invalid email format.', 400);

    const existing = await db.prepare('SELECT id FROM users WHERE email = ?')
      .bind(email.toLowerCase().trim()).first();
    if (existing) return err('An account with this email already exists.', 409);

    const salt = generateSalt();
    const hashedPw = await pbkdf2(password, salt);
    let result;
    try {
      result = await db.prepare(
        'INSERT INTO users (name, email, password, salt, role, is_approved) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(name.trim(), email.toLowerCase().trim(), hashedPw, salt, 'student', 1).run();
    } catch (e) {
      return err('An account with this email already exists.', 409);
    }

    await db.prepare(
      'INSERT INTO audit_logs (user_id, action, ip_address, user_agent) VALUES (?, ?, ?, ?)'
    ).bind(result.meta.last_row_id, 'user_registered', getIp(request), getUa(request)).run();

    const token = await signToken({
      id: result.meta.last_row_id, email: email.toLowerCase().trim(), role: 'student',
      exp: Date.now() + 30 * 24 * 60 * 60 * 1000
    }, secret);

    return json({
      token,
      user: { id: result.meta.last_row_id, name: name.trim(), email: email.toLowerCase().trim(), role: 'student' }
    }, 201);
  }

  if (method === 'POST' && path === '/auth/login') {
    const { email, password } = body || {};
    if (!email || !password) return err('Email and password required.', 400);

    const user = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email.toLowerCase().trim()).first();
    if (!user) return err('Invalid email or password.', 401);

    const hashedPw = await pbkdf2(password, user.salt);
    if (user.password !== hashedPw) {
      await db.prepare(
        'INSERT INTO audit_logs (user_id, action, ip_address, user_agent) VALUES (?, ?, ?, ?)'
      ).bind(user.id, 'login_failed', getIp(request), getUa(request)).run();
      return err('Invalid email or password.', 401);
    }

    if (user.is_blocked) return err('Your account has been blocked. Contact admin.', 403);
    if (!user.is_approved) return err('Your account is pending approval.', 403);

    await db.prepare(
      'INSERT INTO audit_logs (user_id, action, ip_address, user_agent) VALUES (?, ?, ?, ?)'
    ).bind(user.id, 'login_success', getIp(request), getUa(request)).run();

    const token = await signToken({
      id: user.id, email: user.email, role: user.role, exp: Date.now() + 30 * 24 * 60 * 60 * 1000
    }, secret);

    return json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  }

  return err('Not found', 404);
}

// ─── USER HANDLER ───────────────────────────────────────────

async function handleUser(method, path, body, db, user, request) {
  if (method === 'GET' && path === '/user/me') {
    const u = await db.prepare(
      'SELECT id, name, email, role, is_approved, is_blocked, created_at FROM users WHERE id = ?'
    ).bind(user.id).first();
    if (!u) return err('User not found', 404);
    return json({ user: u });
  }

  if (method === 'GET' && path === '/user/courses') {
    const courses = await db.prepare(`
      SELECT c.* FROM courses c
      JOIN enrollments e ON c.id = e.course_id
      WHERE e.user_id = ?
      ORDER BY c.created_at DESC
    `).bind(user.id).all();
    return json({ courses: courses.results });
  }

  if (method === 'GET' && path === '/user/course') {
    const url = new URL(request.url);
    const courseId = url.searchParams.get('id');
    if (!courseId) return err('Course ID required', 400);

    if (user.role !== 'admin') {
      const enrollment = await db.prepare(
        'SELECT * FROM enrollments WHERE user_id = ? AND course_id = ?'
      ).bind(user.id, courseId).first();
      if (!enrollment) return err('Not enrolled in this course', 403);
    }

    const course = await db.prepare('SELECT * FROM courses WHERE id = ?').bind(courseId).first();
    if (!course) return err('Course not found', 404);

    const subjects = await db.prepare(
      'SELECT * FROM subjects WHERE course_id = ? ORDER BY sort_order ASC, id ASC'
    ).bind(courseId).all();

    const resources = await db.prepare(
      'SELECT * FROM resources WHERE course_id = ? ORDER BY sort_order ASC, id ASC'
    ).bind(courseId).all();

    const subjectsWithChapters = [];
    for (const sub of subjects.results) {
      const chapters = await db.prepare(
        'SELECT * FROM chapters WHERE subject_id = ? ORDER BY sort_order ASC, id ASC'
      ).bind(sub.id).all();

      const chaptersWithLectures = [];
      for (const chap of chapters.results) {
        const lectures = await db.prepare(
          'SELECT * FROM lectures WHERE chapter_id = ? ORDER BY sort_order ASC, id ASC'
        ).bind(chap.id).all();
        chaptersWithLectures.push({ ...chap, lectures: lectures.results });
      }
      subjectsWithChapters.push({ ...sub, chapters: chaptersWithLectures });
    }

    return json({ course, subjects: subjectsWithChapters, resources: resources.results });
  }

  if (method === 'GET' && path === '/user/notifications/unread-count') {
    const count = await db.prepare(
      'SELECT COUNT(*) as count FROM notifications WHERE (user_id = ? OR user_id IS NULL) AND is_read = 0'
    ).bind(user.id).first();
    return json({ count: count.count });
  }

  if (method === 'GET' && path === '/user/notifications') {
    const notifications = await db.prepare(`
      SELECT * FROM notifications
      WHERE user_id = ? OR user_id IS NULL
      ORDER BY created_at DESC
      LIMIT 50
    `).bind(user.id).all();
    return json({ notifications: notifications.results });
  }

  if (method === 'PUT' && path === '/user/notifications/read') {
    await db.prepare(
      'UPDATE notifications SET is_read = 1 WHERE (user_id = ? OR user_id IS NULL) AND is_read = 0'
    ).bind(user.id).run();
    return json({ message: 'All notifications marked as read.' });
  }

  if (method === 'PUT' && path.match(/^\/user\/notifications\/\d+\/read$/)) {
    const id = parseInt(path.split('/')[3]);
    await db.prepare(
      'UPDATE notifications SET is_read = 1 WHERE id = ? AND (user_id = ? OR user_id IS NULL)'
    ).bind(id, user.id).run();
    return json({ message: 'Notification marked as read.' });
  }

  return err('Not found', 404);
}

// ─── ADMIN HANDLER ──────────────────────────────────────────

async function handleAdmin(method, path, body, db, user, request) {
  // USERS
  if (method === 'GET' && path === '/admin/users') {
    const users = await db.prepare(`
      SELECT id, name, email, role, is_approved, is_blocked, created_at
      FROM users ORDER BY created_at DESC
    `).all();
    return json({ users: users.results });
  }

  if (method === 'PUT' && path.match(/^\/admin\/users\/\d+\/block$/)) {
    const userId = parseInt(path.split('/')[3]);
    await db.prepare('UPDATE users SET is_blocked = 1 WHERE id = ?').bind(userId).run();
    await db.prepare(
      'INSERT INTO audit_logs (user_id, action, ip_address, user_agent) VALUES (?, ?, ?, ?)'
    ).bind(user.id, `blocked_user_${userId}`, getIp(request), getUa(request)).run();
    return json({ message: 'User blocked.' });
  }

  if (method === 'PUT' && path.match(/^\/admin\/users\/\d+\/unblock$/)) {
    const userId = parseInt(path.split('/')[3]);
    await db.prepare('UPDATE users SET is_blocked = 0 WHERE id = ?').bind(userId).run();
    await db.prepare(
      'INSERT INTO audit_logs (user_id, action, ip_address, user_agent) VALUES (?, ?, ?, ?)'
    ).bind(user.id, `unblocked_user_${userId}`, getIp(request), getUa(request)).run();
    return json({ message: 'User unblocked.' });
  }

  if (method === 'DELETE' && path.match(/^\/admin\/users\/\d+$/)) {
    const userId = parseInt(path.split('/')[3]);
    await db.prepare('DELETE FROM enrollments WHERE user_id = ?').bind(userId).run();
    await db.prepare('DELETE FROM notifications WHERE user_id = ?').bind(userId).run();
    await db.prepare('DELETE FROM audit_logs WHERE user_id = ?').bind(userId).run();
    await db.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
    await db.prepare(
      'INSERT INTO audit_logs (user_id, action, ip_address, user_agent) VALUES (?, ?, ?, ?)'
    ).bind(user.id, `deleted_user_${userId}`, getIp(request), getUa(request)).run();
    return json({ message: 'User deleted.' });
  }

  // ENROLLMENTS
  if (method === 'POST' && path === '/admin/enrollments') {
    const { user_id, course_id } = body || {};
    if (!user_id || !course_id) return err('user_id and course_id required', 400);
    await db.prepare('INSERT OR IGNORE INTO enrollments (user_id, course_id) VALUES (?, ?)')
      .bind(user_id, course_id).run();
    await db.prepare(
      'INSERT INTO audit_logs (user_id, action, ip_address, user_agent) VALUES (?, ?, ?, ?)'
    ).bind(user.id, `enrolled_user_${user_id}_course_${course_id}`, getIp(request), getUa(request)).run();
    return json({ message: 'User enrolled in course.' });
  }

  if (method === 'DELETE' && path.match(/^\/admin\/enrollments\/\d+\/\d+$/)) {
    const parts = path.split('/');
    const userId = parseInt(parts[3]);
    const courseId = parseInt(parts[4]);
    await db.prepare('DELETE FROM enrollments WHERE user_id = ? AND course_id = ?')
      .bind(userId, courseId).run();
    await db.prepare(
      'INSERT INTO audit_logs (user_id, action, ip_address, user_agent) VALUES (?, ?, ?, ?)'
    ).bind(user.id, `unenrolled_user_${userId}_course_${courseId}`, getIp(request), getUa(request)).run();
    return json({ message: 'User unenrolled from course.' });
  }

  if (method === 'GET' && path === '/admin/enrollments') {
    const enrollments = await db.prepare(`
      SELECT e.*, u.name as user_name, u.email as user_email, c.title as course_title
      FROM enrollments e
      JOIN users u ON e.user_id = u.id
      JOIN courses c ON e.course_id = c.id
      ORDER BY e.enrolled_at DESC
    `).all();
    return json({ enrollments: enrollments.results });
  }

  // COURSES
  if (method === 'GET' && path === '/admin/courses') {
    const courses = await db.prepare('SELECT * FROM courses ORDER BY created_at DESC').all();
    return json({ courses: courses.results });
  }

  if (method === 'POST' && path === '/admin/courses') {
    const { title, description, thumbnail_url, icon, is_featured } = body || {};
    if (!title) return err('Title required', 400);
    const result = await db.prepare(
      'INSERT INTO courses (title, description, thumbnail_url, icon, is_featured) VALUES (?, ?, ?, ?, ?)'
    ).bind(title.trim(), description || '', thumbnail_url || '', icon || '📚', is_featured ? 1 : 0).run();
    await db.prepare(
      'INSERT INTO audit_logs (user_id, action, ip_address, user_agent) VALUES (?, ?, ?, ?)'
    ).bind(user.id, `created_course_${result.meta.last_row_id}`, getIp(request), getUa(request)).run();
    return json({ id: result.meta.last_row_id, message: 'Course created.' }, 201);
  }

  if (method === 'PUT' && path.match(/^\/admin\/courses\/\d+$/)) {
    const courseId = parseInt(path.split('/')[3]);
    const { title, description, thumbnail_url, icon, is_featured } = body || {};
    if (!title) return err('Title required', 400);
    await db.prepare(
      `UPDATE courses SET title = ?, description = ?, thumbnail_url = ?, icon = ?,
       is_featured = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(title.trim(), description || '', thumbnail_url || '', icon || '📚', is_featured ? 1 : 0, courseId).run();
    return json({ message: 'Course updated.' });
  }

  if (method === 'DELETE' && path.match(/^\/admin\/courses\/\d+$/)) {
    const courseId = parseInt(path.split('/')[3]);
    await db.prepare('DELETE FROM courses WHERE id = ?').bind(courseId).run();
    await db.prepare(
      'INSERT INTO audit_logs (user_id, action, ip_address, user_agent) VALUES (?, ?, ?, ?)'
    ).bind(user.id, `deleted_course_${courseId}`, getIp(request), getUa(request)).run();
    return json({ message: 'Course deleted.' });
  }

  // SUBJECTS
  if (method === 'POST' && path === '/admin/subjects') {
    const { course_id, title, description, sort_order } = body || {};
    if (!course_id || !title) return err('course_id and title required', 400);
    const result = await db.prepare(
      'INSERT INTO subjects (course_id, title, description, sort_order) VALUES (?, ?, ?, ?)'
    ).bind(course_id, title.trim(), description || '', sort_order || 0).run();
    return json({ id: result.meta.last_row_id, message: 'Subject created.' }, 201);
  }

  if (method === 'PUT' && path.match(/^\/admin\/subjects\/\d+$/)) {
    const subjectId = parseInt(path.split('/')[3]);
    const { title, description, sort_order } = body || {};
    if (!title) return err('Title required', 400);
    await db.prepare(
      "UPDATE subjects SET title = ?, description = ?, sort_order = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(title.trim(), description || '', sort_order || 0, subjectId).run();
    return json({ message: 'Subject updated.' });
  }

  if (method === 'DELETE' && path.match(/^\/admin\/subjects\/\d+$/)) {
    const subjectId = parseInt(path.split('/')[3]);
    await db.prepare('DELETE FROM subjects WHERE id = ?').bind(subjectId).run();
    return json({ message: 'Subject deleted.' });
  }

  // CHAPTERS
  if (method === 'POST' && path === '/admin/chapters') {
    const { subject_id, title, description, sort_order } = body || {};
    if (!subject_id || !title) return err('subject_id and title required', 400);
    const result = await db.prepare(
      'INSERT INTO chapters (subject_id, title, description, sort_order) VALUES (?, ?, ?, ?)'
    ).bind(subject_id, title.trim(), description || '', sort_order || 0).run();
    return json({ id: result.meta.last_row_id, message: 'Chapter created.' }, 201);
  }

  if (method === 'PUT' && path.match(/^\/admin\/chapters\/\d+$/)) {
    const chapterId = parseInt(path.split('/')[3]);
    const { title, description, sort_order } = body || {};
    if (!title) return err('Title required', 400);
    await db.prepare(
      "UPDATE chapters SET title = ?, description = ?, sort_order = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(title.trim(), description || '', sort_order || 0, chapterId).run();
    return json({ message: 'Chapter updated.' });
  }

  if (method === 'DELETE' && path.match(/^\/admin\/chapters\/\d+$/)) {
    const chapterId = parseInt(path.split('/')[3]);
    await db.prepare('DELETE FROM chapters WHERE id = ?').bind(chapterId).run();
    return json({ message: 'Chapter deleted.' });
  }

  // LECTURES
  if (method === 'POST' && path === '/admin/lectures') {
    const { chapter_id, title, youtube_id, pdf_url, sort_order, send_notification } = body || {};
    if (!chapter_id || !title) return err('chapter_id and title required', 400);
    const result = await db.prepare(
      'INSERT INTO lectures (chapter_id, title, youtube_id, pdf_url, sort_order) VALUES (?, ?, ?, ?, ?)'
    ).bind(chapter_id, title.trim(), youtube_id || '', pdf_url || '', sort_order || 0).run();

    if (send_notification !== false) {
      const chapter = await db.prepare('SELECT title as chapter_title FROM chapters WHERE id = ?')
        .bind(chapter_id).first();
      const subject = await db.prepare(
        'SELECT title as subject_title FROM subjects WHERE id = (SELECT subject_id FROM chapters WHERE id = ?)'
      ).bind(chapter_id).first();
      const course = await db.prepare(`
        SELECT id, title as course_title FROM courses
        WHERE id = (SELECT course_id FROM subjects WHERE id = (SELECT subject_id FROM chapters WHERE id = ?))
      `).bind(chapter_id).first();

      const notifTitle = `New lecture: ${title}`;
      const notifMsg = `${course?.course_title || ''} → ${subject?.subject_title || ''} → ${chapter?.chapter_title || ''}`;
      const link = `/lecture.html?lecture_id=${result.meta.last_row_id}&course_id=${course?.id || ''}`;

      const enrolledUsers = await db.prepare(`
        SELECT DISTINCT user_id FROM enrollments
        WHERE course_id = (SELECT course_id FROM subjects WHERE id = (SELECT subject_id FROM chapters WHERE id = ?))
      `).bind(chapter_id).all();

      const stmt = db.prepare('INSERT INTO notifications (user_id, title, message, link) VALUES (?, ?, ?, ?)');
      const batch = enrolledUsers.results.map(row => stmt.bind(row.user_id, notifTitle, notifMsg, link));
      batch.push(stmt.bind(null, notifTitle, `New lecture available: ${title}`, link));
      await db.batch(batch);
    }

    await db.prepare(
      'INSERT INTO audit_logs (user_id, action, ip_address, user_agent) VALUES (?, ?, ?, ?)'
    ).bind(user.id, `created_lecture_${result.meta.last_row_id}`, getIp(request), getUa(request)).run();

    return json({ id: result.meta.last_row_id, message: 'Lecture created.' }, 201);
  }

  if (method === 'PUT' && path.match(/^\/admin\/lectures\/\d+$/)) {
    const lectureId = parseInt(path.split('/')[3]);
    const { title, youtube_id, pdf_url, sort_order } = body || {};
    if (!title) return err('Title required', 400);
    await db.prepare(
      "UPDATE lectures SET title = ?, youtube_id = ?, pdf_url = ?, sort_order = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(title.trim(), youtube_id || '', pdf_url || '', sort_order || 0, lectureId).run();
    return json({ message: 'Lecture updated.' });
  }

  if (method === 'DELETE' && path.match(/^\/admin\/lectures\/\d+$/)) {
    const lectureId = parseInt(path.split('/')[3]);
    await db.prepare('DELETE FROM lectures WHERE id = ?').bind(lectureId).run();
    return json({ message: 'Lecture deleted.' });
  }

  // RESOURCES
  if (method === 'POST' && path === '/admin/resources') {
    const { course_id, title, description, link_url, sort_order } = body || {};
    if (!course_id || !title) return err('course_id and title required', 400);
    const result = await db.prepare(
      'INSERT INTO resources (course_id, title, description, link_url, sort_order) VALUES (?, ?, ?, ?, ?)'
    ).bind(course_id, title.trim(), description || '', link_url || '', sort_order || 0).run();
    return json({ id: result.meta.last_row_id, message: 'Resource created.' }, 201);
  }

  if (method === 'PUT' && path.match(/^\/admin\/resources\/\d+$/)) {
    const resourceId = parseInt(path.split('/')[3]);
    const { title, description, link_url, sort_order } = body || {};
    if (!title) return err('Title required', 400);
    await db.prepare(
      "UPDATE resources SET title = ?, description = ?, link_url = ?, sort_order = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(title.trim(), description || '', link_url || '', sort_order || 0, resourceId).run();
    return json({ message: 'Resource updated.' });
  }

  if (method === 'DELETE' && path.match(/^\/admin\/resources\/\d+$/)) {
    const resourceId = parseInt(path.split('/')[3]);
    await db.prepare('DELETE FROM resources WHERE id = ?').bind(resourceId).run();
    return json({ message: 'Resource deleted.' });
  }

  // NOTIFICATIONS (admin)
  if (method === 'GET' && path === '/admin/notifications') {
    const notifications = await db.prepare(`
      SELECT n.*, u.name as user_name FROM notifications n
      LEFT JOIN users u ON n.user_id = u.id
      ORDER BY n.created_at DESC LIMIT 200
    `).all();
    return json({ notifications: notifications.results });
  }

  if (method === 'POST' && path === '/admin/notifications') {
    const { title, message, link, user_id } = body || {};
    if (!title || !message) return err('Title and message required', 400);

    if (user_id) {
      await db.prepare('INSERT INTO notifications (user_id, title, message, link) VALUES (?, ?, ?, ?)')
        .bind(user_id, title.trim(), message.trim(), link || '').run();
    } else {
      const users = await db.prepare('SELECT id FROM users WHERE role != ?').bind('admin').all();
      const stmt = db.prepare('INSERT INTO notifications (user_id, title, message, link) VALUES (?, ?, ?, ?)');
      const batch = users.results.map(u => stmt.bind(u.id, title.trim(), message.trim(), link || ''));
      batch.push(stmt.bind(null, title.trim(), message.trim(), link || ''));
      await db.batch(batch);
    }

    await db.prepare(
      'INSERT INTO audit_logs (user_id, action, ip_address, user_agent) VALUES (?, ?, ?, ?)'
    ).bind(user.id, `created_notification_${title}`, getIp(request), getUa(request)).run();

    return json({ message: 'Notification sent.' }, 201);
  }

  if (method === 'DELETE' && path.match(/^\/admin\/notifications\/\d+$/)) {
    const id = parseInt(path.split('/')[3]);
    await db.prepare('DELETE FROM notifications WHERE id = ?').bind(id).run();
    return json({ message: 'Notification deleted.' });
  }

  // AUDIT LOGS
  if (method === 'GET' && path === '/admin/audit-logs') {
    const logs = await db.prepare(`
      SELECT a.*, u.name as user_name, u.email as user_email
      FROM audit_logs a LEFT JOIN users u ON a.user_id = u.id
      ORDER BY a.created_at DESC LIMIT 500
    `).all();
    return json({ logs: logs.results });
  }

  if (method === 'DELETE' && path.match(/^\/admin\/audit-logs\/\d+$/)) {
    const logId = parseInt(path.split('/')[3]);
    await db.prepare('DELETE FROM audit_logs WHERE id = ?').bind(logId).run();
    return json({ message: 'Log deleted.' });
  }

  if (method === 'DELETE' && path === '/admin/audit-logs/all') {
    await db.prepare('DELETE FROM audit_logs').run();
    await db.prepare(
      'INSERT INTO audit_logs (user_id, action, ip_address, user_agent) VALUES (?, ?, ?, ?)'
    ).bind(user.id, 'deleted_all_audit_logs', getIp(request), getUa(request)).run();
    return json({ message: 'All audit logs deleted.' });
  }

  // STATS
  if (method === 'GET' && path === '/admin/stats') {
    const totalUsers = await db.prepare('SELECT COUNT(*) as count FROM users').first();
    const totalCourses = await db.prepare('SELECT COUNT(*) as count FROM courses').first();
    const totalEnrollments = await db.prepare('SELECT COUNT(*) as count FROM enrollments').first();
    const totalLectures = await db.prepare('SELECT COUNT(*) as count FROM lectures').first();
    const blockedUsers = await db.prepare('SELECT COUNT(*) as count FROM users WHERE is_blocked = 1').first();
    return json({
      stats: {
        total_users: totalUsers.count, total_courses: totalCourses.count,
        total_enrollments: totalEnrollments.count, total_lectures: totalLectures.count,
        blocked_users: blockedUsers.count
      }
    });
  }

  // BULK IMPORT
  if (method === 'POST' && path === '/admin/bulk-import/quick') {
    const { chapter_id, lectures } = body || {};
    if (!chapter_id || !lectures || !Array.isArray(lectures) || !lectures.length) {
      return err('chapter_id and lectures array required', 400);
    }
    const stmt = db.prepare(
      'INSERT INTO lectures (chapter_id, title, youtube_id, pdf_url, sort_order) VALUES (?, ?, ?, ?, ?)'
    );
    const batch = lectures.map((l, i) => stmt.bind(chapter_id, l.title.trim(), l.youtube_id || '', l.pdf_url || '', i));
    const results = await db.batch(batch);
    const inserted = results.filter(r => r.meta?.last_row_id).length;

    await db.prepare(
      'INSERT INTO audit_logs (user_id, action, ip_address, user_agent) VALUES (?, ?, ?, ?)'
    ).bind(user.id, `bulk_import_quick_${inserted}_lectures`, getIp(request), getUa(request)).run();

    return json({ message: `Imported ${inserted} lectures.` });
  }

  if (method === 'POST' && path === '/admin/bulk-import/full') {
    const { course_id, data } = body || {};
    if (!course_id || !data || !Array.isArray(data)) return err('course_id and data array required', 400);

    let totalLectures = 0;
    for (let si = 0; si < data.length; si++) {
      const subject = data[si];
      const subResult = await db.prepare(
        'INSERT INTO subjects (course_id, title, description, sort_order) VALUES (?, ?, ?, ?) RETURNING id'
      ).bind(course_id, subject.title.trim(), subject.description || '', si).first();
      const subjectId = subResult.id;

      for (let ci = 0; ci < (subject.chapters || []).length; ci++) {
        const chapter = subject.chapters[ci];
        const chapResult = await db.prepare(
          'INSERT INTO chapters (subject_id, title, description, sort_order) VALUES (?, ?, ?, ?) RETURNING id'
        ).bind(subjectId, chapter.title.trim(), chapter.description || '', ci).first();
        const chapterId = chapResult.id;

        for (let li = 0; li < (chapter.lectures || []).length; li++) {
          const lecture = chapter.lectures[li];
          await db.prepare(
            'INSERT INTO lectures (chapter_id, title, youtube_id, pdf_url, sort_order) VALUES (?, ?, ?, ?, ?)'
          ).bind(chapterId, lecture.title.trim(), lecture.youtube_id || '', lecture.pdf_url || '', li).run();
          totalLectures++;
        }
      }
    }

    await db.prepare(
      'INSERT INTO audit_logs (user_id, action, ip_address, user_agent) VALUES (?, ?, ?, ?)'
    ).bind(user.id, `bulk_import_full_${totalLectures}_lectures`, getIp(request), getUa(request)).run();

    return json({ message: `Imported ${totalLectures} lectures across ${data.length} subjects.` });
  }

  return err('Not found', 404);
}

// ─── PUBLIC ROUTES ──────────────────────────────────────────

async function handlePublic(method, path, db, request) {
  if (method === 'GET' && path === '/courses/explore') {
    const courses = await db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM subjects WHERE course_id = c.id) as subject_count,
        (SELECT COUNT(*) FROM lectures l
         JOIN chapters ch ON l.chapter_id = ch.id
         JOIN subjects s ON ch.subject_id = s.id
         WHERE s.course_id = c.id) as lecture_count
      FROM courses c
      ORDER BY c.is_featured DESC, c.created_at DESC
    `).all();
    return json({ courses: courses.results });
  }

  if (method === 'GET' && path.match(/^\/courses\/\d+$/)) {
    const courseId = parseInt(path.split('/')[2]);
    const course = await db.prepare('SELECT * FROM courses WHERE id = ?').bind(courseId).first();
    if (!course) return err('Course not found', 404);

    const subjects = await db.prepare(
      'SELECT * FROM subjects WHERE course_id = ? ORDER BY sort_order ASC, id ASC'
    ).bind(courseId).all();
    const resources = await db.prepare(
      'SELECT * FROM resources WHERE course_id = ? ORDER BY sort_order ASC, id ASC'
    ).bind(courseId).all();

    const subjectsWithChapters = [];
    for (const sub of subjects.results) {
      const chapters = await db.prepare(
        'SELECT * FROM chapters WHERE subject_id = ? ORDER BY sort_order ASC, id ASC'
      ).bind(sub.id).all();

      const chaptersWithLectures = [];
      for (const chap of chapters.results) {
        const lectures = await db.prepare(
          'SELECT * FROM lectures WHERE chapter_id = ? ORDER BY sort_order ASC, id ASC'
        ).bind(chap.id).all();
        chaptersWithLectures.push({ ...chap, lectures: lectures.results });
      }
      subjectsWithChapters.push({ ...sub, chapters: chaptersWithLectures });
    }

    return json({ course, subjects: subjectsWithChapters, resources: resources.results });
  }

  return err('Not found', 404);
}

// ─── MAIN ROUTER ────────────────────────────────────────────

export async function onRequest(context) {
  const { request, env } = context;
  const db = env.FIDES_DB;
  const secret = env.JWT_SECRET || 'fides-learning-jwt-secret-key-2026'; // set JWT_SECRET in Pages env vars for production
  const url = new URL(request.url);
  const method = request.method;
  const path = url.pathname.replace('/api', '');

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  // Self-creating schema — replaces the separate wrangler d1 execute step
  await ensureSchema(db);

  let body = null;
  if (method === 'POST' || method === 'PUT') {
    try { body = await request.json(); } catch (e) { body = {}; }
  }

  if (path.startsWith('/auth/') || path === '/admin/setup-status' || path === '/admin/setup') {
    return handleAuth(method, path, body, db, request, secret);
  }

  if (path === '/courses/explore' || path.match(/^\/courses\/\d+$/)) {
    return handlePublic(method, path, db, request);
  }

  const authUser = await getUser(request, secret);
  if (!authUser) return err('Authentication required.', 401);

  if (path.startsWith('/admin/')) {
    if (authUser.role !== 'admin') return err('Forbidden. Admin access required.', 403);
    return handleAdmin(method, path, body, db, authUser, request);
  }

  if (path.startsWith('/user/')) {
    return handleUser(method, path, body, db, authUser, request);
  }

  return err('API endpoint not found', 404);
}
