# @artificialislab/blog-client-react

Cliente TypeScript canonico do `core-blog-api` consumido pelos sites Vite/React.

Substitui as 3 cópias quase-iguais de `src/lib/api.ts` em
`client-alinefranca-website`, `client-anapaulamafra-website` e
`client-carolinacalegari-website`. Reduz ~300 linhas duplicadas por site +
divergencia (Aline/Ana batem `/uploads/admin`, Carolina batia
`/api/uploads/admin` com dual-auth Bearer+cookie).

## Decisao canonica

- **Auth**: cookie httpOnly only. Sem JWT no localStorage. Sem Bearer.
  Cookie é emitido pelo `core-blog-api` em `/auth/login` e enviado
  automaticamente via `credentials: "include"`.
- **Base URL**: default `/api`. Override via `new BlogClient({ baseUrl: ... })`
  ou variavel de ambiente `VITE_BLOG_API_BASE` no app que importa.
- **Upload**: `POST /uploads/admin` (sem prefixo `/api/`). Backend valida
  MIME, signature binaria, tamanho 5MB cap, rate-limit, path traversal.
- **Tipos**: `Post`, `PostStatus`, `AdminUser`, `LoginResponse`,
  `UploadResponse` exportados — use estes em vez de redeclarar.

## Uso

```ts
import { BlogClient } from "@artificialislab/blog-client-react";

const blog = new BlogClient({
  baseUrl: import.meta.env.VITE_BLOG_API_BASE ?? "/api",
});

// Publico
const posts = await blog.listPublishedPosts();
const post = await blog.getPostBySlug("meu-post");

// Admin (cookie)
await blog.login("admin@cliente.com.br", "senha");
const me = await blog.me();
const all = await blog.listPosts({ status: "draft", limit: 50 });
await blog.updatePost(id, { title: "Novo titulo" });

// Upload com defesa em profundidade
const { url } = await blog.uploadImage(file);
if (!BlogClient.isSafeUploadUrl(url)) {
  throw new Error("backend retornou URL suspeita");
}
editor.commands.setImage({ src: url });
```

## Build local

```bash
cd packages/blog-client-react
npm install
npm run build
```

Saida: `dist/` com `.js`, `.d.ts`, sourcemaps.

## Migracao dos 3 sites (follow-up planejado)

Cada site segue o mesmo padrao:

1. `npm install @artificialislab/blog-client-react` (uma vez publicada via
   GitHub Packages ou via `npm link` no monorepo local).
2. Trocar `import { apiListPosts, apiLogin, ... } from "@/lib/api"` por
   `const blog = new BlogClient(); blog.listPosts(); blog.login(...)`.
3. Deletar `src/lib/api.ts` (e `src/lib/blog/api.ts` na Aline).
4. Smoke test + deploy.

Não migrar tudo de uma vez. Estrategia: começar pela Ana Paula (mais limpa,
ja so usa cookie). Aline depois (tem upload inline editor — caso de uso
mais sensivel). Carolina por ultimo (precisa decidir antes se Bearer ainda
e necessario; provavelmente não).

## Por que dentro do core-blog-api?

A API e o cliente sao acoplados por contrato (mesmo schema, mesmas rotas).
Mante-los no mesmo repo garante que mudancas de breaking change vao no
mesmo PR e ficam visiveis pra quem revisa.

Se eventualmente o cliente crescer pra ter casos divergentes (mobile,
SSR, etc), faz sentido extrair pra repo proprio. Por ora monorepo simples
e suficiente.

## Status

**v0.1.0 — esqueleto canonico**. Pronto pra build local. Publicacao em
GitHub Packages e migracao dos sites sao tasks separadas (follow-up).
