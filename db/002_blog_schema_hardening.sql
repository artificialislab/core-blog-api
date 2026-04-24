-- Hardening for existing databases created before the current 001_init.sql.
-- Keeps re-runs idempotent and makes app-required columns explicit.

do $$ begin
  create type public.post_status as enum ('draft', 'scheduled', 'published');
exception when duplicate_object then null; end $$;

alter table public.blog_users
  add column if not exists role text not null default 'editor',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists last_login_at timestamptz;

update public.blog_users
set role = 'editor'
where role is null or role not in ('editor', 'admin');

alter table public.blog_users
  alter column role set default 'editor',
  alter column role set not null;

alter table public.blog_users
  drop constraint if exists blog_users_role_chk;
alter table public.blog_users
  add constraint blog_users_role_chk
  check (role in ('editor', 'admin')) not valid;

create unique index if not exists blog_users_email_lower_idx
  on public.blog_users (lower(email));

alter table public.blog_posts
  add column if not exists excerpt text not null default '',
  add column if not exists cover text,
  add column if not exists content text not null default '',
  add column if not exists category text not null default '',
  add column if not exists tags text[] not null default '{}',
  add column if not exists status public.post_status not null default 'draft',
  add column if not exists published_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists seo jsonb not null default '{}'::jsonb,
  add column if not exists author_id uuid;

update public.blog_posts
set status = 'draft'
where status is null;

alter table public.blog_posts
  alter column status set default 'draft',
  alter column status set not null;

do $$ begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'blog_posts_author_id_fkey'
      and conrelid = 'public.blog_posts'::regclass
  ) then
    alter table public.blog_posts
      add constraint blog_posts_author_id_fkey
      foreign key (author_id) references public.blog_users(id) on delete set null;
  end if;
end $$;

create unique index if not exists blog_posts_slug_key on public.blog_posts(slug);
create index if not exists blog_posts_status_idx       on public.blog_posts(status);
create index if not exists blog_posts_published_at_idx on public.blog_posts(published_at desc);
create index if not exists blog_posts_category_idx     on public.blog_posts(category);
create index if not exists blog_posts_slug_lower_idx   on public.blog_posts(lower(slug));

alter table public.blog_posts
  drop constraint if exists blog_posts_scheduled_published_at_chk;
alter table public.blog_posts
  add constraint blog_posts_scheduled_published_at_chk
  check (status <> 'scheduled' or published_at is not null) not valid;
