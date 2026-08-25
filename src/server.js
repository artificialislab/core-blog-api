import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';

import authRoutes from './routes/auth.js';
import postsRoutes from './routes/posts.js';
import uploadsRoutes from './routes/uploads.js';
import adminSeedRoutes from './routes/admin-seed.js';
import seoRoutes from './routes/seo.js';
import { startSeoRefreshLoop } from './seo/refresh.js';
import { pool } from './db.js';

const app = express();
const PORT = Number(process.env.PORT || 3001);
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/uploads';

// Trust proxy: o setup canônico do core-blog-api é Caddy → blog-api num bridge
// network do compose, então o request chega no Express vindo do IP do Caddy
// (não 127.0.0.1). Confiar em 1 hop por padrão pra que req.ip reflita o IP
// real do cliente (X-Forwarded-For setado pelo Caddy) e o rate limiter não
// colapse todo o tráfego numa única bucket. Cliente pode override via
// TRUST_PROXY env (ex: 'loopback', 'true', '2', etc).
const _trustProxy = process.env.TRUST_PROXY;
if (_trustProxy === undefined || _trustProxy === '') {
  app.set('trust proxy', 1);
} else if (_trustProxy === 'true' || _trustProxy === 'false') {
  app.set('trust proxy', _trustProxy === 'true');
} else if (/^\d+$/.test(_trustProxy)) {
  app.set('trust proxy', Number(_trustProxy));
} else {
  app.set('trust proxy', _trustProxy);
}

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
app.use('/uploads', uploadsRoutes);       // compat: POST /uploads em clientes antigos
app.use('/admin/seed', adminSeedRoutes);  // POST /admin/seed — provisioning (seed token)
app.use('/seo/admin', seoRoutes);         // GET /seo/admin/status, POST /seo/admin/refresh

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
  // Regera sitemap/llms/HTML dos artigos a partir do estado atual do banco.
  // No-op quando SEO_SITE_DIR nao esta setado (sites ainda nao migrados).
  startSeoRefreshLoop();
});
