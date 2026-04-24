-- ============================================================================
-- Artificialis Lab — Blog API, schema inicial
-- ----------------------------------------------------------------------------
-- Genérico, reutilizado em todos os clientes (multi-tenant por VPS isolada,
-- não por tenant_id — cada cliente tem seu próprio Postgres).
-- Idempotente: usa IF NOT EXISTS em tudo pra permitir re-aplicação segura.
-- ============================================================================

-- Enum pra status de publicação (espelha o tipo PostStatus do frontend)
do $$ begin
  create type public.post_status as enum ('draft', 'scheduled', 'published');
exception when duplicate_object then null; end $$;

-- ─── Tabela de usuários do painel admin ─────────────────────────────────────
-- Email: armazenado em lowercase (normalizado no app) + índice unique em
-- lower(email) pra comparação case-insensitive. Evita depender de extensão
-- citext (que exigiria role SUPERUSER pra instalar).
create table if not exists public.blog_users (
  id             uuid primary key default gen_random_uuid(),
  email          text not null,
  password_hash  text not null,
  name           text not null default '',
  role           text not null default 'editor' check (role in ('editor', 'admin')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  last_login_at  timestamptz
);

create unique index if not exists blog_users_email_lower_idx on public.blog_users (lower(email));

-- ─── Tabela de posts ─────────────────────────────────────────────────────────
create table if not exists public.blog_posts (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  title         text not null,
  excerpt       text not null default '',
  cover         text,
  content       text not null default '',
  category      text not null default '',
  tags          text[] not null default '{}',
  status        public.post_status not null default 'draft',
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  seo           jsonb not null default '{}'::jsonb,
  author_id     uuid references public.blog_users(id) on delete set null
);

-- ─── Índices pra listagem pública performática ──────────────────────────────
create index if not exists blog_posts_status_idx       on public.blog_posts(status);
create index if not exists blog_posts_published_at_idx on public.blog_posts(published_at desc);
create index if not exists blog_posts_category_idx     on public.blog_posts(category);
create index if not exists blog_posts_slug_lower_idx   on public.blog_posts(lower(slug));

-- Defesa no Postgres: posts agendados precisam ter data definida pela API.
-- NOT VALID evita quebrar bases antigas durante re-aplicacao do schema, mas passa
-- a proteger inserts/updates novos.
alter table public.blog_posts
  drop constraint if exists blog_posts_scheduled_published_at_chk;
alter table public.blog_posts
  add constraint blog_posts_scheduled_published_at_chk
  check (status <> 'scheduled' or published_at is not null) not valid;

-- ─── Trigger pra atualizar updated_at automaticamente ───────────────────────
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists blog_posts_touch_updated_at on public.blog_posts;
create trigger blog_posts_touch_updated_at
  before update on public.blog_posts
  for each row execute function public.touch_updated_at();

drop trigger if exists blog_users_touch_updated_at on public.blog_users;
create trigger blog_users_touch_updated_at
  before update on public.blog_users
  for each row execute function public.touch_updated_at();
