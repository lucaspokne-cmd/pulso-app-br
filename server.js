'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const mysql = require('mysql2/promise');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const ALLOWED_VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v']);
const ALLOWED_VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.m4v']);
const scrypt = promisify(crypto.scrypt);
const rate = new Map();

let pool;
let databaseState = 'starting';
let databaseError = null;

function sessionSecret() {
  return process.env.PULSO_SESSION_SECRET || process.env.MANUS_JWT_SECRET || process.env.JWT_SECRET || '';
}

function databaseUrl() {
  return process.env.DATABASE_URL || process.env.DRIZZLE_DATABASE_URL || '';
}

function storageConfig() {
  return {
    url: String(process.env.MANUS_API_URL || '').replace(/\/+$/, ''),
    key: process.env.MANUS_API_KEY || ''
  };
}

async function initializeDatabase() {
  if (!databaseUrl()) throw new Error('DATABASE_URL não está configurada.');
  if (!sessionSecret()) throw new Error('PULSO_SESSION_SECRET não está configurado.');
  const parsed = new URL(databaseUrl());
  pool = mysql.createPool({
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ''),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: { rejectUnauthorized: false }
  });
  await pool.query('SELECT 1');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id CHAR(36) NOT NULL PRIMARY KEY,
      username VARCHAR(24) NOT NULL,
      email VARCHAR(120) NOT NULL,
      salt CHAR(32) NOT NULL,
      hash CHAR(128) NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_users_username (username),
      UNIQUE KEY uq_users_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS videos (
      id CHAR(36) NOT NULL PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      title VARCHAR(100) NOT NULL,
      storage_key VARCHAR(255) NOT NULL,
      storage_url VARCHAR(512) NOT NULL,
      mime VARCHAR(100) NOT NULL,
      bytes BIGINT UNSIGNED NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_videos_storage_key (storage_key),
      KEY idx_videos_created_at (created_at),
      CONSTRAINT fk_videos_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS likes (
      video_id CHAR(36) NOT NULL,
      user_id CHAR(36) NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (video_id, user_id),
      CONSTRAINT fk_likes_video FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
      CONSTRAINT fk_likes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS comments (
      id CHAR(36) NOT NULL PRIMARY KEY,
      video_id CHAR(36) NOT NULL,
      user_id CHAR(36) NOT NULL,
      text VARCHAR(500) NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      KEY idx_comments_video_created (video_id, created_at),
      CONSTRAINT fk_comments_video FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
      CONSTRAINT fk_comments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

function json(res, status, data) {
  const out = Buffer.from(JSON.stringify(data));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': out.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(out);
}

function cleanUser(user) {
  return { id: user.id, username: user.username, createdAt: user.created_at || user.createdAt };
}

function tokenFor(user) {
  const payload = Buffer.from(JSON.stringify({
    sub: user.id,
    exp: Date.now() + 7 * 24 * 3600 * 1000
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function tokenPayload(req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer ([A-Za-z0-9_.-]+)$/);
  if (!match) return null;
  const parts = match[1].split('.');
  if (parts.length !== 2) return null;
  let payload;
  let supplied;
  try {
    payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    supplied = Buffer.from(parts[1], 'base64url');
  } catch {
    return null;
  }
  const expected = crypto.createHmac('sha256', sessionSecret()).update(parts[0]).digest();
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  if (!payload.sub || !Number.isFinite(payload.exp) || payload.exp < Date.now()) return null;
  return payload;
}

async function auth(req) {
  const payload = tokenPayload(req);
  if (!payload) return null;
  const [rows] = await pool.execute('SELECT id, username, email, created_at FROM users WHERE id = ? LIMIT 1', [payload.sub]);
  return rows[0] || null;
}

function readBody(req, max = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > max) {
        settled = true;
        reject(Object.assign(new Error('Corpo muito grande'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!settled) resolve(Buffer.concat(chunks));
    });
    req.on('error', error => {
      if (!settled) reject(error);
    });
  });
}

async function bodyJson(req, max = 1024 * 1024) {
  const body = await readBody(req, max);
  try {
    return JSON.parse(body.toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('JSON inválido'), { status: 400 });
  }
}

function rateLimit(req, res) {
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const recent = (rate.get(ip) || []).filter(time => now - time < 60_000);
  if (recent.length >= 120) {
    json(res, 429, { error: 'Muitas solicitações. Aguarde um minuto.' });
    return false;
  }
  recent.push(now);
  rate.set(ip, recent);
  return true;
}

function normalizeUsername(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 24);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase().slice(0, 120);
}

function extensionFor(filename) {
  return path.extname(String(filename || '')).toLowerCase();
}

function validVideo({ filename, mime, bytes }) {
  const type = String(mime || '').toLowerCase();
  const size = Number(bytes);
  return ALLOWED_VIDEO_EXTENSIONS.has(extensionFor(filename))
    && ALLOWED_VIDEO_TYPES.has(type)
    && Number.isInteger(size)
    && size > 0
    && size <= MAX_VIDEO_BYTES;
}

function storageAddress(key) {
  return `/manus-storage/${key.split('/').map(encodeURIComponent).join('/')}`;
}

async function platformRequest(endpoint, options = {}) {
  const storage = storageConfig();
  if (!storage.url || !storage.key) throw new Error('O armazenamento durável do PULSE não está configurado.');
  const response = await fetch(`${storage.url}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${storage.key}`,
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text); } catch { /* resposta não-JSON */ }
  if (!response.ok) {
    const detail = data.error || text || `HTTP ${response.status}`;
    throw new Error(`Falha no armazenamento: ${detail}`);
  }
  return data;
}

async function presignPut(key) {
  const data = await platformRequest(`/v1/storage/presign/put?path=${encodeURIComponent(key)}`);
  if (!data.url) throw new Error('O armazenamento não devolveu uma URL de upload.');
  return data.url;
}

async function finalizeVideoUpload(key) {
  if (!key.startsWith('videos/') || key.includes('..') || !/^[A-Za-z0-9._/-]+$/.test(key)) return false;
  try {
    const data = await platformRequest(`/v1/storage/presign/get?path=${encodeURIComponent(key)}`);
    if (!data.url) return false;
    const response = await fetch(data.url, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}

async function hashPassword(password, salt) {
  return (await scrypt(password, salt, 64)).toString('hex');
}

async function verifyPassword(password, salt, storedHash) {
  const actual = Buffer.from(await hashPassword(password, salt), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function publicVideo(video) {
  return {
    id: video.id,
    title: video.title,
    username: video.username,
    url: video.storage_url,
    mime: video.mime,
    bytes: Number(video.bytes),
    createdAt: video.created_at,
    likes: Number(video.likes || 0),
    liked: Boolean(video.liked),
    comments: Number(video.comment_count || 0)
  };
}

async function feed(viewerId) {
  const [rows] = await pool.execute(`
    SELECT
      v.id, v.title, v.storage_url, v.mime, v.bytes, v.created_at,
      u.username,
      COUNT(DISTINCT l.user_id) AS likes,
      COUNT(DISTINCT c.id) AS comment_count,
      EXISTS(SELECT 1 FROM likes vl WHERE vl.video_id = v.id AND vl.user_id = ?) AS liked
    FROM videos v
    INNER JOIN users u ON u.id = v.user_id
    LEFT JOIN likes l ON l.video_id = v.id
    LEFT JOIN comments c ON c.video_id = v.id
    GROUP BY v.id, v.title, v.storage_url, v.mime, v.bytes, v.created_at, u.username
    ORDER BY v.created_at DESC
    LIMIT 100
  `, [viewerId || '']);
  return rows.map(publicVideo);
}

const server = http.createServer(async (req, res) => {
  if (!rateLimit(req, res)) return;
  const url = new URL(req.url, 'http://localhost');
  const route = url.pathname;

  try {
    if (req.method === 'GET' && route === '/api/health') {
      if (databaseState === 'ready') return json(res, 200, { ok: true, service: 'PULSE', database: 'ready' });
      return json(res, 503, { ok: false, service: 'PULSE', database: databaseState, error: databaseError ? 'Base de dados indisponível.' : 'A iniciar.' });
    }

    if (databaseState !== 'ready') return json(res, 503, { error: 'O serviço ainda está a iniciar. Tente novamente em instantes.' });

    if (req.method === 'POST' && route === '/api/register') {
      const body = await bodyJson(req);
      const username = normalizeUsername(body.username);
      const email = normalizeEmail(body.email);
      const password = String(body.password || '');
      if (username.length < 3 || password.length < 8 || !/^([^\s@]+)@([^\s@]+)\.([^\s@]+)$/.test(email)) {
        return json(res, 400, { error: 'Informe nome (3+ caracteres), e-mail válido e senha de 8+ caracteres.' });
      }
      const [existing] = await pool.execute('SELECT id FROM users WHERE email = ? OR username = ? LIMIT 1', [email, username]);
      if (existing.length) return json(res, 409, { error: 'Esse e-mail ou nome de usuário já está cadastrado.' });
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = await hashPassword(password, salt);
      const user = { id: crypto.randomUUID(), username, email, salt, hash };
      await pool.execute('INSERT INTO users (id, username, email, salt, hash) VALUES (?, ?, ?, ?, ?)', [user.id, user.username, user.email, user.salt, user.hash]);
      return json(res, 201, { token: tokenFor(user), user: { id: user.id, username: user.username, createdAt: new Date().toISOString() } });
    }

    if (req.method === 'POST' && route === '/api/login') {
      const body = await bodyJson(req);
      const email = normalizeEmail(body.email);
      const password = String(body.password || '');
      const [rows] = await pool.execute('SELECT id, username, email, salt, hash, created_at FROM users WHERE email = ? LIMIT 1', [email]);
      const user = rows[0];
      if (!user || !(await verifyPassword(password, user.salt, user.hash))) return json(res, 401, { error: 'E-mail ou senha incorretos.' });
      return json(res, 200, { token: tokenFor(user), user: cleanUser(user) });
    }

    if (req.method === 'GET' && route === '/api/feed') {
      const viewer = await auth(req);
      return json(res, 200, { videos: await feed(viewer?.id) });
    }

    if (!route.startsWith('/api/')) {
      if (req.method !== 'GET') return json(res, 405, { error: 'Método não permitido.' });
      const requested = route === '/' ? 'index.html' : route.slice(1);
      const target = path.resolve(PUBLIC, requested);
      if (!target.startsWith(PUBLIC + path.sep)) return json(res, 403, { error: 'Acesso negado.' });
      const types = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.svg': 'image/svg+xml'
      };
      return fs.readFile(target, (error, body) => {
        if (error) return json(res, 404, { error: 'Não encontrado.' });
        res.writeHead(200, {
          'Content-Type': types[path.extname(target)] || 'application/octet-stream',
          'Content-Length': body.length,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': target.endsWith('.html') ? 'no-cache' : 'public, max-age=3600'
        });
        res.end(body);
      });
    }

    const user = await auth(req);
    if (!user) return json(res, 401, { error: 'Entre na sua conta para continuar.' });

    if (req.method === 'GET' && route === '/api/me') return json(res, 200, { user: cleanUser(user) });

    if (req.method === 'POST' && route === '/api/videos/upload-url') {
      const body = await bodyJson(req);
      const filename = String(body.filename || '').slice(0, 255);
      const mime = String(body.mime || '').toLowerCase();
      const bytes = Number(body.bytes);
      if (!validVideo({ filename, mime, bytes })) return json(res, 400, { error: 'Formato ou tamanho inválido. Use MP4, WebM ou MOV até 100 MB.' });
      const ext = extensionFor(filename);
      const key = `videos/${user.id}/${crypto.randomUUID()}${ext}`;
      const uploadUrl = await presignPut(key);
      return json(res, 200, { uploadUrl, key, storageUrl: storageAddress(key), mime, bytes });
    }

    if (req.method === 'POST' && route === '/api/videos') {
      const body = await bodyJson(req);
      const key = String(body.key || '');
      const mime = String(body.mime || '').toLowerCase();
      const bytes = Number(body.bytes);
      const filename = String(body.filename || key);
      if (!key.startsWith(`videos/${user.id}/`) || !validVideo({ filename, mime, bytes })) return json(res, 400, { error: 'Upload de vídeo inválido.' });
      const [already] = await pool.execute('SELECT id FROM videos WHERE storage_key = ? LIMIT 1', [key]);
      if (already.length) return json(res, 409, { error: 'Este vídeo já foi publicado.' });
      if (!(await finalizeVideoUpload(key))) return json(res, 400, { error: 'O ficheiro ainda não está disponível no armazenamento. Tente novamente.' });
      const ext = extensionFor(filename);
      const title = String(body.title || '').trim().slice(0, 100) || path.basename(filename, ext).slice(0, 100) || 'Meu vídeo';
      const video = { id: crypto.randomUUID(), userId: user.id, title, key, mime, bytes };
      await pool.execute('INSERT INTO videos (id, user_id, title, storage_key, storage_url, mime, bytes) VALUES (?, ?, ?, ?, ?, ?, ?)', [video.id, video.userId, video.title, video.key, storageAddress(video.key), video.mime, video.bytes]);
      return json(res, 201, { video: (await feed(user.id)).find(item => item.id === video.id) || null });
    }

    const like = route.match(/^\/api\/videos\/([^/]+)\/like$/);
    if (req.method === 'POST' && like) {
      const [videos] = await pool.execute('SELECT id FROM videos WHERE id = ? LIMIT 1', [like[1]]);
      if (!videos.length) return json(res, 404, { error: 'Vídeo não encontrado.' });
      const [current] = await pool.execute('SELECT video_id FROM likes WHERE video_id = ? AND user_id = ? LIMIT 1', [like[1], user.id]);
      if (current.length) await pool.execute('DELETE FROM likes WHERE video_id = ? AND user_id = ?', [like[1], user.id]);
      else await pool.execute('INSERT INTO likes (video_id, user_id) VALUES (?, ?)', [like[1], user.id]);
      const [count] = await pool.execute('SELECT COUNT(*) AS total FROM likes WHERE video_id = ?', [like[1]]);
      return json(res, 200, { likes: Number(count[0].total), liked: !current.length });
    }

    const comments = route.match(/^\/api\/videos\/([^/]+)\/comments$/);
    if (req.method === 'GET' && comments) {
      const [rows] = await pool.execute(`
        SELECT c.id, c.text, c.created_at, u.username
        FROM comments c INNER JOIN users u ON u.id = c.user_id
        WHERE c.video_id = ? ORDER BY c.created_at ASC
      `, [comments[1]]);
      return json(res, 200, { comments: rows.map(comment => ({ id: comment.id, text: comment.text, username: comment.username, createdAt: comment.created_at })) });
    }
    if (req.method === 'POST' && comments) {
      const [videos] = await pool.execute('SELECT id FROM videos WHERE id = ? LIMIT 1', [comments[1]]);
      if (!videos.length) return json(res, 404, { error: 'Vídeo não encontrado.' });
      const body = await bodyJson(req);
      const text = String(body.text || '').trim().slice(0, 500);
      if (!text) return json(res, 400, { error: 'Escreva um comentário.' });
      const comment = { id: crypto.randomUUID(), videoId: comments[1], userId: user.id, text };
      await pool.execute('INSERT INTO comments (id, video_id, user_id, text) VALUES (?, ?, ?, ?)', [comment.id, comment.videoId, comment.userId, comment.text]);
      return json(res, 201, { comment: { id: comment.id, text: comment.text, username: user.username, createdAt: new Date().toISOString() } });
    }

    return json(res, 404, { error: 'Rota da API não encontrada.' });
  } catch (error) {
    if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'Erro interno. Verifique os logs do servidor.' });
    else res.destroy();
    if (!error.status) console.error(error);
  }
});

server.listen(PORT, HOST, () => {
  initializeDatabase()
    .then(() => {
      databaseState = 'ready';
      console.log(`PULSE pronto em http://${HOST}:${PORT} com base de dados gerida.`);
    })
    .catch(error => {
      databaseState = 'error';
      databaseError = error;
      console.error('Falha ao preparar a aplicação:', error.message);
    });
});

process.on('SIGTERM', async () => {
  await pool?.end().catch(() => {});
  server.close(() => process.exit(0));
});
process.on('SIGINT', async () => {
  await pool?.end().catch(() => {});
  server.close(() => process.exit(0));
});
