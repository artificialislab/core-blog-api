import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { one } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET;
const COOKIE_NAME = process.env.COOKIE_NAME || 'blog_admin_session';
const TOKEN_TTL = process.env.TOKEN_TTL || '30d';
const DUMMY_PASSWORD_HASH = '$2a$12$IU1tNkzYj/BgQ9FsBHt0/.AZC8gr3jaEBKQfk4JqBU.oFUCUCDKBO';
const COOKIE_SECURE = process.env.COOKIE_SECURE
  ? process.env.COOKIE_SECURE === 'true'
  : process.env.NODE_ENV === 'production';

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET ausente ou curto (mínimo 32 chars). Setar no .env.');
}

/**
 * Valida email+senha contra blog_users. Retorna o row (sem o hash) se OK,
 * null caso contrário. Faz bcrypt.compare mesmo em user inexistente pra
 * evitar ataque de timing na enumeração de emails.
 */
export async function verifyPassword(email, password) {
  const user = await one(
    `select id, email, password_hash, name, role
     from blog_users
     where lower(email) = $1
     limit 1`,
    [String(email).trim().toLowerCase()],
  );
  // Dummy hash pra manter timing uniforme mesmo quando user não existe.
  const hash = user?.password_hash || DUMMY_PASSWORD_HASH;
  const ok = await bcrypt.compare(password || '', hash);
  if (!user || !ok) return null;
  // Audit: last_login_at
  void one(`update blog_users set last_login_at = now() where id = $1 returning id`, [user.id])
    .catch((err) => console.error('[auth audit error]', err.message));
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL },
  );
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

/**
 * Middleware Express que extrai JWT do cookie OU do Authorization Bearer,
 * verifica, e carrega req.user. Rejeita com 401 se inválido.
 */
export function requireAuth(req, res, next) {
  (async () => {
    const fromHeader = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    const fromCookie = req.cookies?.[COOKIE_NAME];
    const tokens = [fromHeader, fromCookie].filter(Boolean);
    if (tokens.length === 0) return res.status(401).json({ error: 'not_authenticated' });

    let claims = null;
    for (const token of tokens) {
      claims = verifyToken(token);
      if (claims?.sub) break;
    }
    if (!claims?.sub) return res.status(401).json({ error: 'invalid_token' });

    const user = await one(
      `select id, email, name, role
       from blog_users
       where id = $1
       limit 1`,
      [claims.sub],
    );
    if (!user) return res.status(401).json({ error: 'invalid_token' });

    req.user = { sub: user.id, email: user.email, name: user.name, role: user.role };
    return next();
  })().catch(next);
}

export function requireRole(...allowedRoles) {
  const allowed = new Set(allowedRoles);
  return (req, res, next) => {
    if (!req.user?.role) return res.status(401).json({ error: 'not_authenticated' });
    if (!allowed.has(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    return next();
  };
}

/** Helpers pra rota /auth/login setar o cookie httpOnly. */
export function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30d
    path: '/',
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export const _constants = { COOKIE_NAME, TOKEN_TTL };
