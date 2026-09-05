# core-blog-api

API genérica de blog usada pelos sites de clientes da Artificialis Lab. Auth (JWT em cookie httpOnly), CRUD de posts (draft/scheduled/published), upload de capas, seed automático de admin inicial.

É consumida por sites React (geralmente Lovable-built) que se comunicam com ela via `/api/*` atrás de um Caddy reverse proxy.

## Arquitetura

```
Site do cliente (React/Vite)        core-blog-api (Node/Express)
  ↓ fetch /api/auth/login             ↓ cookie-parser + JWT
  ↓ fetch /api/posts                  ↓ pg Pool
  ↓ fetch /api/uploads/admin          ↓ multer → /uploads volume
           ↓
       Caddy (TLS termination)
       handle_path /api/*   →   blog-api:3001
       handle /uploads/*    →   blog-api:3001
       *                    →   nginx estático do site
```

## Serviços do stack do cliente

O `docker-compose.yml` gerado pelo platform backend (serviceRecipes.js) sobe:

- `postgres` (17-alpine) — DB dedicado por cliente
- `blog-api` (ghcr.io/artificialislab/blog-api) — esta imagem
- `nginx` (site estático — quando subscribed_services inclui "website")
- `caddy` — reverse proxy + TLS automático

Network isolada por cliente. Sem portas expostas pro público além do 443 do Caddy.

## Endpoints

### Público

- `GET /health` → `{ status, db, version }`
- `GET /posts` → lista posts com `status='published'`
- `GET /posts/slug/:slug` → post público pelo slug

### Admin (requer JWT via cookie `COOKIE_NAME` ou `Authorization: Bearer`)

- `POST /auth/login` body `{ email, password }` → seta cookie + retorna `{ user, token }`
- `POST /auth/logout` → limpa cookie
- `GET  /auth/me` → user atual
- `GET  /posts/admin/all` → todos os posts (inclusive draft)
- `GET  /posts/admin/:id`
- `POST /posts/admin` body `{ title, slug?, excerpt?, cover?, content?, category?, tags?, status?, publishedAt?, seo? }`
- `PUT  /posts/admin/:id`
- `DELETE /posts/admin/:id`
- `POST /uploads/admin` multipart `file` (max 5MB default, imagens) → `{ url, size, mime }`

### SEO (requer JWT admin/editor)

- `GET  /seo/admin/status` → estado da geração (habilitada? qual diretório? config lido?)
- `POST /seo/admin/refresh` → força a regeneração agora (usado pelo CI logo após o deploy do site)

### Provisioning (requer `X-Seed-Token`)

- `POST /admin/seed` body `{ email, name? }` → cria admin inicial, retorna senha gerada **uma vez**. Se email já existe, retorna 409 sem tocar.

## SEO em runtime (sitemap + pré-render dos artigos)

Os sites de cliente são SPAs servidas como estático pelo nginx. Historicamente
o `sitemap.xml`, o `llms.txt` e o HTML pré-renderizado de cada artigo eram
gerados **só no `npm run build`** do site. Como o deploy é manual, publicar um
artigo no painel não produzia efeito nenhum para o Google: o artigo ficava fora
do sitemap, a listagem `/blog` não trazia link nenhum em HTML, e a URL direta
devolvia o shell da home — com `canonical` apontando para `/`.

A partir da v1.1 quem é dono desses artefatos é esta API, em runtime.

```
painel publica post
        ↓
POST/PUT/DELETE /posts/admin  →  scheduleSeoRefresh()  (debounce 3s)
        ↓
src/seo/refresh.js  lê  $SEO_SITE_DIR/seo.config.json + index.html
        ↓
reescreve no volume que o nginx serve:
  sitemap.xml
  llms.txt
  blog/index.html            (com <a href> reais para cada artigo)
  blog/<slug>/index.html     (title, description, canonical, JSON-LD e o TEXTO)
```

Também roda no startup do container e a cada `SEO_REFRESH_INTERVAL_MS`
(para pegar posts agendados que venceram).

**Contrato com o site:** o build do site precisa emitir `seo.config.json` ao
lado do `index.html`, com o que é específico daquele cliente — `siteUrl`,
marca, rotas estáticas, textos do `llms.txt`, `@id`s de JSON-LD. A API é
genérica e não sabe nada disso sozinha. Sem esse arquivo a geração fica
desligada em silêncio e o site continua se comportando como antes.

Ver `src/seo/render.js` (puro, testado em `tests/seoRender.test.mjs`) e
`src/seo/refresh.js` (IO + agendamento).

## Env vars

Ver `.env.example`. Obrigatórias:

- `DATABASE_URL` — postgresql://user:pass@postgres:5432/dbname
- `JWT_SECRET` — mínimo 32 chars (gerar com `openssl rand -base64 48`)
- `SEED_TOKEN` — mínimo 32 chars, protege POST /admin/seed

Opcionais: `PORT`, `UPLOAD_DIR`, `UPLOAD_MAX_BYTES`, `CORS_ORIGINS`, `COOKIE_NAME`, `TOKEN_TTL`, `BLOG_API_VERSION`.

## Build local

```bash
npm install
docker build -t blog-api:local .
docker run --rm -p 3001:3001 --env-file .env blog-api:local
```

## Imagem pública

`ghcr.io/artificialislab/blog-api:latest` (build via GitHub Actions em push pra main ou tags `v*.*.*`).

## Schema

`db/001_init.sql` — idempotente, roda no startup via `src/migrate.js`. Novos migrations vão como `db/002_*.sql`, `db/003_*.sql` etc.

## Seed manual (reset de senha)

Se o cliente esqueceu a senha ou o cara do dev precisa resetar:

```bash
docker compose exec blog-api node src/seed-admin.js admin@cliente.com.br NovaSenha123 "Admin"
```

O `POST /admin/seed` recusa sobrescrever por design (evita reset acidental via reinstall). Resetar é ação deliberada via CLI.
