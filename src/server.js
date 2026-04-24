import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import path from 'node:path';

import authRoutes from './routes/auth.js';
import postsRoutes from './routes/posts.js';
import uploadsRoutes from './routes/uploads.js';
import adminSeedRoutes from './routes/admin-seed.js';
import { pool } from './db.js';

const app = express();
const PORT = Number(process.env.PORT || 3001);
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/uploads';

app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');

/**
 * CORS — blog API e site geralmente são served pelo mesmo domínio
 * (via Caddy reverse proxy), então mesma origem. Mantemos CORS permissivo
 * pra requests same-origin, mais uma lista explicita pra dev local ou
 * previews. Cliente configura via CORS_ORIGINS env var.
 */
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:8080')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // curl/server-to-server
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error('cors_blocked'), false);
  },
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// ─── Static serve das capas (mesma origem via Caddy) ───────────────────────
// Caddy roteia /uploads/* direto pra essa rota; o browser vê <dominio>/uploads/...
app.use('/uploads', express.static(UPLOAD_DIR, {
  maxAge: '7d',
  index: false,
  dotfiles: 'deny',
}));

// ─── Healthcheck — usado pelo Docker healthcheck e pelo Caddy upstream ─────
app.get('/health', async (_req, res) => {
  try {
    await pool.query('select 1');
    res.json({ status: 'ok', db: 'connected', version: process.env.BLOG_API_VERSION || 'dev' });
  } catch (err) {
    res.status(503).json({ status: 'degraded', db: 'error', error: err.message });
  }
});

// ─── Rotas ─────────────────────────────────────────────────────────────────
app.use('/auth', authRoutes);
app.use('/posts', postsRoutes);
app.use('/uploads/admin', uploadsRoutes); // POST /uploads/admin pra criar upload
app.use('/admin/seed', adminSeedRoutes);  // POST /admin/seed — provisioning (seed token)

// 404 padrão
app.use((_req, res) => res.status(404).json({ error: 'not_found' }));

// Error handler
app.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.message === 'cors_blocked') {
    return res.status(403).json({ error: 'cors_blocked' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'invalid_json' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'payload_too_large' });
  }
  const status = Number(err.status || err.statusCode);
  if (status >= 400 && status < 500) {
    return res.status(status).json({ error: 'bad_request' });
  }
  // eslint-disable-next-line no-console
  console.error('[api error]', err.stack || err.message);
  res.status(500).json({ error: 'internal_error' });
});

app.listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`[api] listening on :${PORT}  upload_dir=${UPLOAD_DIR}`);
});
