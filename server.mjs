import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID, pbkdf2, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(ROOT, 'data');
const DATA_FILE = join(DATA_DIR, 'bank.json');
const IMAGE_DIR = join(ROOT, 'images');
const SESSION_MS = 8 * 60 * 60 * 1000;
const sessions = new Map();
const loginAttempts = new Map();
const pages = new Map([
  ['/', 'site/index.html'], ['/index.html', 'site/index.html'], ['/accounts.html', 'site/accounts.html'],
  ['/payments.html', 'site/payments.html'], ['/cards.html', 'site/cards.html'], ['/auth.html', 'auth.html'],
  ['/app.js', 'app.js'], ['/auth.js', 'auth.js'], ['/styles.css', 'styles.css']
]);
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const imageTypes = { '.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

function readStore() {
  try {
    const stored = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
    return { users: Array.isArray(stored.users) ? stored.users : [], requests: Array.isArray(stored.requests) ? stored.requests : [] };
  }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { users: [], requests: [] };
  }
}

function saveStore(store) {
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const temporary = `${DATA_FILE}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(store, null, 2), { mode: 0o600 });
  renameSync(temporary, DATA_FILE);
}

function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function makePasswordHash(password, salt) {
  return new Promise((resolve, reject) => pbkdf2(password, salt, 310000, 32, 'sha256', (error, key) => error ? reject(error) : resolve(key.toString('hex'))));
}
function getSession(request) {
  const cookie = request.headers.cookie || '';
  const token = cookie.split(';').map(part => part.trim()).find(part => part.startsWith('megabank_session='))?.slice('megabank_session='.length);
  if (!token) return null;
  const key = hash(token);
  const session = sessions.get(key);
  if (!session || session.expiresAt <= Date.now()) { sessions.delete(key); return null; }
  session.expiresAt = Date.now() + SESSION_MS;
  return { ...session, key };
}
function setSession(response, request, userId) {
  const token = randomBytes(32).toString('base64url');
  const csrf = randomBytes(32).toString('base64url');
  sessions.set(hash(token), { userId, csrf, expiresAt: Date.now() + SESSION_MS });
  const secure = request.socket.encrypted ? '; Secure' : '';
  response.setHeader('Set-Cookie', `megabank_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}${secure}`);
  return csrf;
}
function clearSession(response) {
  response.setHeader('Set-Cookie', 'megabank_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}
function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(value));
}
function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 16_384) fail(413, 'Request is too large.');
  }
  try {
    const value = JSON.parse(body || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'Request must be a JSON object.');
    return value;
  }
  catch { fail(400, 'Invalid JSON request.'); }
}
function checkSameOrigin(request) {
  const origin = request.headers.origin;
  if (origin && new URL(origin).host !== request.headers.host) fail(403, 'Request origin was rejected.');
  if (request.headers['x-requested-with'] !== 'fetch') fail(403, 'Request was rejected.');
}
function requireCsrf(request, session) {
  checkSameOrigin(request);
  if (!session || request.headers['x-csrf-token'] !== session.csrf) fail(403, 'Your session expired. Refresh and try again.');
}
function amountCents(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) fail(400, 'Enter an amount greater than zero and no more than $1,000,000.');
  return Math.round(amount * 100);
}
function publicUser(user) { return { id: user.id, name: user.name, email: user.email }; }
function rateLimit(request) {
  const key = `${request.socket.remoteAddress || 'local'}:${String(request.body?.email || '').toLowerCase()}`;
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (!current || current.until < now) loginAttempts.set(key, { count: 1, until: now + 60_000 });
  else if (++current.count > 8) fail(429, 'Too many sign-in attempts. Try again in a minute.');
}
async function handleApi(request, response, url) {
  const session = getSession(request);
  const store = readStore();
  if (request.method === 'POST') {
    request.body = await readJson(request);
    checkSameOrigin(request);
  }

  if (url.pathname === '/api/register' && request.method === 'POST') {
    const { name, email, password } = request.body;
    const cleanName = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (cleanName.length < 2 || cleanName.length > 70) fail(400, 'Enter your name (2 to 70 characters).');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || cleanEmail.length > 254) fail(400, 'Enter a valid email address.');
    if (typeof password !== 'string' || password.length < 12 || password.length > 128) fail(400, 'Use a password between 12 and 128 characters.');
    if (store.users.some(user => user.email === cleanEmail)) fail(409, 'An account with that email already exists.');
    const id = randomUUID();
    const salt = randomBytes(16).toString('hex');
    const passwordHash = await makePasswordHash(password, salt);
    const user = { id, name: cleanName, email: cleanEmail, passwordSalt: salt, passwordHash, createdAt: new Date().toISOString() };
    store.users.push(user);
    saveStore(store);
    const csrf = setSession(response, request, id);
    return sendJson(response, 201, { user: publicUser(user), csrf });
  }

  if (url.pathname === '/api/login' && request.method === 'POST') {
    rateLimit(request);
    const email = typeof request.body.email === 'string' ? request.body.email.trim().toLowerCase() : '';
    const password = typeof request.body.password === 'string' ? request.body.password : '';
    const user = store.users.find(item => item.email === email);
    const candidate = await makePasswordHash(password.slice(0, 128), user?.passwordSalt || 'megabank-invalid-user-salt');
    const expected = user?.passwordHash || '0'.repeat(64);
    const valid = timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(expected, 'hex'));
    if (!user || !valid) fail(401, 'Email or password is incorrect.');
    loginAttempts.delete(`${request.socket.remoteAddress || 'local'}:${email}`);
    const csrf = setSession(response, request, user.id);
    return sendJson(response, 200, { user: publicUser(user), csrf });
  }

  if (url.pathname === '/api/logout' && request.method === 'POST') {
    requireCsrf(request, session);
    sessions.delete(session.key); clearSession(response);
    return sendJson(response, 200, { ok: true });
  }

  if (!session) fail(401, 'Please sign in to continue.');
  const user = store.users.find(item => item.id === session.userId);
  if (!user) fail(401, 'Please sign in to continue.');
  if (url.pathname === '/api/data' && request.method === 'GET') {
    const requests = store.requests.filter(item => item.userId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return sendJson(response, 200, { user: publicUser(user), csrf: session.csrf, requests });
  }

  if (url.pathname === '/api/requests' && request.method === 'POST') {
    requireCsrf(request, session);
    const { type } = request.body;
    if (!['account', 'transfer', 'card'].includes(type)) fail(400, 'Choose a valid request type.');
    const record = { id: randomUUID(), userId: user.id, type, status: 'received', createdAt: new Date().toISOString() };
    if (type === 'transfer') {
      const recipientEmail = typeof request.body.recipientEmail === 'string' ? request.body.recipientEmail.trim().toLowerCase() : '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) fail(400, 'Enter a valid recipient email address.');
      const recipient = store.users.find(item => item.email === recipientEmail);
      if (!recipient) fail(404, 'Recipient must register before a transfer request can be saved.');
      if (recipient.id === user.id) fail(400, 'Choose another registered customer.');
      record.recipientEmail = recipientEmail;
      record.amountCents = amountCents(request.body.amount);
      record.memo = typeof request.body.memo === 'string' ? request.body.memo.trim().slice(0, 80) : '';
    }
    if (type === 'account') {
      if (!['checking', 'savings'].includes(request.body.product)) fail(400, 'Choose checking or savings.');
      record.product = request.body.product;
    }
    if (type === 'card') {
      if (!['debit', 'credit'].includes(request.body.product)) fail(400, 'Choose debit or credit.');
      record.product = request.body.product;
    }
    if (store.requests.filter(item => item.userId === user.id).length >= 100) fail(429, 'You have reached the request limit.');
    store.requests.push(record);
    saveStore(store);
    return sendJson(response, 201, { request: record });
  }

  fail(404, 'Endpoint not found.');
}

function sendPage(request, response, pathname) {
  const session = getSession(request);
  if (pathname === '/auth.html' && session) { response.writeHead(302, { Location: '/index.html', 'Cache-Control': 'no-store' }); return response.end(); }
  if (['/index.html', '/accounts.html', '/payments.html', '/cards.html', '/'].includes(pathname) && !session) {
    response.writeHead(302, { Location: '/auth.html', 'Cache-Control': 'no-store' }); return response.end();
  }
  const filename = pages.get(pathname);
  if (!filename) { response.writeHead(404); return response.end('Not found'); }
  const content = readFileSync(join(ROOT, filename));
  response.writeHead(200, {
    'Content-Type': mimeTypes[extname(filename)], 'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin'
  });
  response.end(content);
}

function sendImage(response, pathname) {
  let requestedPath;
  try { requestedPath = decodeURIComponent(pathname.slice('/images/'.length)); }
  catch { response.writeHead(400); return response.end('Invalid image path'); }
  const imagePath = resolve(IMAGE_DIR, requestedPath);
  const imageRelativePath = relative(IMAGE_DIR, imagePath);
  if (!requestedPath || imageRelativePath.startsWith('..') || isAbsolute(imageRelativePath)) {
    response.writeHead(404); return response.end('Not found');
  }
  const contentType = imageTypes[extname(imagePath).toLowerCase()];
  if (!contentType) { response.writeHead(415); return response.end('Unsupported image type'); }
  try {
    if (!statSync(imagePath).isFile()) { response.writeHead(404); return response.end('Not found'); }
    response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
    response.end(readFileSync(imagePath));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    response.writeHead(404); response.end('Not found');
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(request, response, url);
    if (url.pathname.startsWith('/images/')) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, { error: 'Method not allowed.' });
      return sendImage(response, url.pathname);
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, { error: 'Method not allowed.' });
    return sendPage(request, response, url.pathname);
  } catch (error) {
    if (response.headersSent) { response.destroy(); return; }
    if (error.status) return sendJson(response, error.status, { error: error.message });
    console.error(error);
    return sendJson(response, 500, { error: 'An unexpected server error occurred.' });
  }
});

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
server.listen(port, host, () => console.log(`Mega Bank sandbox ready at http://${host}:${port}`));
