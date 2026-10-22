const crypto = require('crypto');
const { db } = require('./db');

const SESSION_DAYS = 14;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(pw, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400e3).toISOString();
  db.prepare('INSERT INTO sessions(token, user_id, expires_at) VALUES(?, ?, ?)').run(token, userId, expires);
  return token;
}

function parseCookies(header = '') {
  const out = {};
  header.split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function loadUser(req, _res, next) {
  const token = parseCookies(req.headers.cookie).sid;
  if (token) {
    const row = db.prepare(`
      SELECT u.id, u.username, u.name, u.role, u.partner_id, p.name AS partner_name, s.expires_at
      FROM sessions s JOIN users u ON u.id = s.user_id
      LEFT JOIN partners p ON p.id = u.partner_id
      WHERE s.token = ? AND u.active = 1`).get(token);
    if (row && row.expires_at > new Date().toISOString()) {
      delete row.expires_at;
      req.user = row;
      req.sessionToken = token;
    }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '로그인이 필요합니다.' });
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '로그인이 필요합니다.' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: '권한이 없습니다.' });
    next();
  };
}

// 파트너 소속 사용자는 자기 파트너의 데이터만, 상담원(agent)은 본인 배정 건만 본다.
function scopeClause(user, alias = 'l') {
  const parts = [];
  const params = [];
  if (user.partner_id) {
    parts.push(`${alias}.partner_id = ?`);
    params.push(user.partner_id);
  }
  if (user.role === 'agent') {
    parts.push(`${alias}.assignee_id = ?`);
    params.push(user.id);
  }
  return { sql: parts.length ? parts.join(' AND ') : '1=1', params };
}

module.exports = { hashPassword, verifyPassword, createSession, loadUser, requireAuth, requireRole, scopeClause };
