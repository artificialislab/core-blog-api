/**
 * seed-admin.js — CLI fallback para criar/resetar admin do blog.
 *
 * Uso normal: o platform backend chama POST /admin/seed automaticamente
 * durante o install. Este script só é usado pra RESET DE SENHA depois
 * (POST /admin/seed recusa sobrescrever contas existentes — por design).
 *
 *   docker compose exec blog-api node src/seed-admin.js <email> <senha> [nome]
 *
 * Idempotente: se o email já existe, atualiza password_hash e name.
 */
import 'dotenv/config';
import { pool } from './db.js';
import { hashPassword } from './auth.js';

async function run() {
  const [, , email, password, ...nameParts] = process.argv;
  const name = nameParts.join(' ').trim() || email?.split('@')[0] || 'admin';

  if (!email || !password) {
    console.error('Uso: node src/seed-admin.js <email> <senha> [nome]');
    console.error('Exemplo: node src/seed-admin.js admin@cliente.com.br SenhaForte123 "Admin"');
    process.exit(2);
  }
  if (password.length < 8) {
    console.error('Senha precisa ter pelo menos 8 caracteres.');
    process.exit(3);
  }

  const hash = await hashPassword(password);

  // ON CONFLICT referencia o unique index em lower(email) — expression index.
  // Parênteses duplos indicam expression match, não coluna direta.
  const result = await pool.query(
    `insert into blog_users (email, password_hash, name, role)
     values ($1, $2, $3, 'admin')
     on conflict ((lower(email))) do update set
       password_hash = excluded.password_hash,
       name = excluded.name,
       updated_at = now()
     returning id, email, name, role, created_at`,
    [email.trim().toLowerCase(), hash, name],
  );

  const user = result.rows[0];
  console.log('[seed-admin] OK');
  console.log(`  id:    ${user.id}`);
  console.log(`  email: ${user.email}`);
  console.log(`  name:  ${user.name}`);
  console.log(`  role:  ${user.role}`);

  await pool.end();
}

run().catch((err) => {
  console.error('[seed-admin] FAIL:', err.message);
  process.exit(1);
});
