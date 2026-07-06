create extension if not exists moddatetime with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create type public.user_role as enum ('admin', 'writer', 'provider');
create type public.article_status as enum ('draft', 'published');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  bio text not null default '',
  homepage_url text,
  sns_links jsonb not null default '[]',
  price_info text,
  contact_url text,
  commission_code text unique,
  created_at timestamptz not null default now()
);

create table public.articles (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  slug text unique check (slug is null or slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null default '',
  body text not null default '',
  cover_image_url text,
  status public.article_status not null default 'draft',
  published_at timestamptz,
  commission_code_input text,
  commissioned_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint published_requires_slug
    check (status = 'draft' or slug is not null),
  constraint published_requires_published_at
    check (status = 'draft' or published_at is not null)
);

create trigger articles_set_updated_at
  before update on public.articles
  for each row execute function extensions.moddatetime(updated_at);

create table public.settings (
  id int primary key check (id = 1),
  post_interval_days int not null default 10 check (post_interval_days >= 0),
  featured_count int not null default 3 check (featured_count >= 0)
);

insert into public.settings (id) values (1);
