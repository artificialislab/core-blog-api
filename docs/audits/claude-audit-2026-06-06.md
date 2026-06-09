# Auditoria técnica — core-blog-api

**Data:** 2026-06-06
**Auditor:** Claude (auditor técnico sênior, modo read-mostly)
**Escopo:** auth JWT/cookie, upload multer, sanitização HTML/XSS, slug, scheduled posts, admin seed, CORS, rate limit, trust proxy, error handling, migrations, pacote client React, compat Caddy.

## 1. Estado git inicial

- Branch `main`, working tree limpo, sincronizado com `origin/main`.
- HEAD: `b9df5f6 fix(deps): patch critical sanitize-html XSS + moderate qs/ip-address (#8)`.
- Observação: `git` emitiu `warning: unable to unlink .git/index.lock: Operation not permitted` (quirk do FUSE no Cowork). Não afeta edições locais; nenhum comando git mutador foi executado.

## 2. Achados por severidade

### Crítico
Nenhum.

### Alto
Nenhum. (Auth, upload e sanitização estão bem construídos — ver notas em "Pontos fortes".)

### Médio

- **M1 — `TOKEN_TTL` numérico (segundos) gera TTL de cookie x TTL de JWT divergentes.** `src/auth.js` (antes da correção).
  O `.env.example:42` e o README documentam `TOKEN_TTL` aceitando segundos puros (ex.: `'3600'`). Porém `jwt.sign({ expiresIn })` interpreta **string numérica** via `vercel/ms` como **milissegundos** (`'3600'` = 3,6 s), enquanto `tokenTtlToCookieMaxAge` tratava `'3600'` como 3600 s. Resultado: com `TOKEN_TTL=3600` o JWT expiraria em ~3,6 s mas o cookie viveria conforme parse próprio → sessão "morta" logo após login, difícil de diagnosticar. **Corrigido** (ver seção 3).

### Baixo

- **B1 — `POST /uploads` (compat legado) sem prefixo é montado duas vezes.** `src/server.js:76-77`. Tanto `/uploads/admin` quanto `/uploads` apontam pro mesmo router cujo handler é `router.post('/')`. Isso significa que `POST /uploads/admin/` casa em `/uploads/admin` → `'/'` e `POST /uploads/` casa em `/uploads` → `'/'`. Funciona, mas o `express.static('/uploads', ...)` (linha 57) é registrado ANTES das rotas de upload? Não — o static está na linha 57 e o router na 76-77; como static só trata GET, o POST passa direto. Sem bug funcional, apenas dupla montagem que pode confundir manutenção. **Não alterado** (mudança de roteamento = risco de quebrar clientes antigos; documentado).

- **B2 — `normalizeAssetUrl` aceita qualquer host HTTPS para `cover`/`ogImage`.** `src/routes/posts.js:47-64`. URLs `https://` externas arbitrárias são aceitas como capa/og-image. Não é XSS (são usadas como `src` de imagem, e o front valida `isSafeUploadUrl` só para uploads internos), mas permite hotlink/SSRF-via-navegador-do-leitor e leak de referrer. Comportamento provavelmente intencional (permitir CDN externo). **Não alterado** — documentado para decisão do André.

- **B3 — `last_login_at` update é fire-and-forget com `void one(...).catch`.** `src/auth.js:35`. Aceitável (audit não deve bloquear login), mas em pico de falha de DB gera log spam. Baixo. Não alterado.

- **B4 — Lockout de conta inexistente no blog-api.** Diferente do rivus-api, o core-blog-api **não tem account lockout** (só rate limit de 10/15min com `skipSuccessfulRequests`). Para um painel de blog de cliente único é aceitável, mas é uma assimetria com o rivus. Documentado como item para o André decidir se vale portar o lockout.

## 3. Correções aplicadas

1. **M1 — normalização de `TOKEN_TTL` numérico** (`src/auth.js`).
   String puramente numérica agora é convertida para `Number` antes de ir ao `jwt.sign`, alinhando a semântica (jsonwebtoken trata `number` como segundos). Assim `TOKEN_TTL=3600` = 1h tanto no JWT quanto no cookie, conforme documentado. Comentário explicativo adicionado.

2. **Teste de regressão** (`tests/sanitizeHtml.test.mjs`).
   Adicionada asserção `tokenTtlToCookieMaxAge(3600) === 3600*1000` cobrindo o formato numérico documentado.

Nenhuma mudança estrutural de auth, versão ou refactor amplo.

## 4. Comandos / testes rodados

- `npm ci --no-audit --no-fund` → 131 pacotes, OK.
- `npm test` (`node --test tests/*.test.mjs`) → **3 pass / 0 fail** (após a correção/novo assert).
- `npm audit --omit=dev` → **found 0 vulnerabilities**.

Nenhum teste exige DB externo — todos rodam offline (sanitização + parser de TTL). Nada precisou ser pulado.

## 5. Riscos restantes / itens para Codex / itens que exigem autorização do André

- **Para o André decidir (B2):** restringir `cover`/`ogImage` a hosts allow-list vs. permitir qualquer HTTPS. Hoje aceita qualquer HTTPS.
- **Para o André decidir (B4):** portar o account-lockout do rivus-api para o blog-api, ou manter só rate limit. Assimetria intencional?
- **Para Codex (B1):** avaliar consolidar as duas montagens de `/uploads`/`/uploads/admin` num único mount com rota nomeada, sem quebrar clientes legados. Refactor de roteamento — fora do escopo de "fix pequeno e seguro".
- **Compat Caddy:** o `trust proxy` default `1` está correto para o setup Caddy-em-container-vizinho (request chega do IP do Caddy, não 127.0.0.1). Sem ação.
- **CORS:** `origin` callback retorna `Error('cors_blocked')`; tratado no error handler como 403. `credentials: true` + allow-list explícita estão corretos para cookies cross-site. Sem ação.
- **Migrations:** idempotentes (IF NOT EXISTS / NOT VALID). `migrate.js` roda cada `.sql` em uma única `pool.query` (multi-statement) — funciona com `pg` porque não usa prepared statements aqui. Sem ação.
