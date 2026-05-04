import { Router } from 'express';
import crypto from 'node:crypto';
import { one } from '../db.js';
import { hashPassword } from '../auth.js';
import { asyncHandler } from '../http.js';
import { seedRateLimit } from '../rateLimit.js';

/**
 * /admin/seed — provisioning endpoint chamado pelo platform backend durante
 * o install do serviço blog-api. Cria a conta admin inicial do blog.
 *
 * Idempotente-safe: se já existe qualquer usuário, retorna 409 sem criar
 * outro admin nem tocar no password_hash. Isso protege contra reinstalação
 * acidental resetar senha ou abrir uma segunda conta administrativa.
 *
 * Autenticação via header X-Seed-Token. Token vem do env SEED_TOKEN
 * (gerado pelo platform junto com o JWT_SECRET e injetado no .env do
 * container). Depois do primeiro seed, novas contas devem ser criadas/resetadas
 * por fluxo explícito fora deste endpoint.
 */
const router = Router();

const SEED_TOKEN = process.env.SEED_TOKEN || '';

function generateStrongPassword(len = 20) {
  // 20 chars base64url ≈ 120 bits de entropia. Mais que suficiente para admin inicial.
  return crypto.randomBytes(len).toString('base64url').slice(0, len);
}

function isSeedTokenValid(presented) {
  if (!SEED_TOKEN || SEED_TOKEN.length < 32) return false;

  const expectedBuffer = Buffer.from(SEED_TOKEN);
  const presentedBuffer = Buffer.from(String(presented || ''));
  return expectedBuffer.length === presentedBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, presentedBuffer);
}

router.post('/', seedRateLimit, asyncHandler(async (req, res) => {
  // Protege o endpoint: só platform backend (com o SEED_TOKEN) pode chamar.
  if (!SEED_TOKEN || SEED_TOKEN.length < 32) {
    return res.status(503).json({ error: 'seed_not_configured' });
  }
  const presented = (req.headers['x-seed-token'] || '').toString();
  if (!isSeedTokenValid(presented)) {
    return res.status(401).json({ error: 'invalid_seed_token' });
  }

  const { email, name } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'invalid_email' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const displayName = String(name || '').trim() || normalizedEmail.split('@')[0];

  // Checa se já existe — índice unique em lower(email).
  const existing = await one(
    `select id, email, created_at from blog_users where lower(email) = $1 limit 1`,
    [normalizedEmail],
  );
  if (existing) {
    return res.status(409).json({
      error: 'user_already_exists',
      message: 'Uma conta com esse email já existe. Use o endpoint de reset de senha (CLI docker exec seed-admin) se precisar trocar a senha.',
      user: { id: existing.id, email: existing.email, created_at: existing.created_at },
    });
  }

  const firstUser = await one(
    `select id, email, created_at from blog_users order by created_at asc limit 1`,
  );
  if (firstUser) {
    return res.status(409).json({
      error: 'seed_already_completed',
      message: 'O seed inicial já foi concluído. Crie ou resete admins por um fluxo explícito fora deste endpoint.',
      user: { id: firstUser.id, email: firstUser.email, created_at: firstUser.created_at },
    });
  }

  // Gera senha forte + hash. A senha em plain text é retornada UMA VEZ
  // na resposta; cliente (platform backend) mostra pro admin e não persiste.
  const plainPassword = generateStrongPassword();
  const hash = await hashPassword(plainPassword);

  const user = await one(
    `insert into blog_users (email, password_hash, name, role)
     values ($1, $2, $3, 'admin')
     returning id, email, name, role, created_at`,
    [normalizedEmail, hash, displayName],
  );

  res.status(201).json({
    user,
    password: plainPassword,
    warning: 'Guarde essa senha agora — ela não será exibida novamente. Se perder, resete via: docker compose exec blog-api node src/seed-admin.js <email> <nova-senha>',
  });
}));

export default router;
