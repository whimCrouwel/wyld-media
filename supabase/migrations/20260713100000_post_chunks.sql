create extension if not exists vector with schema extensions;
create extension if not exists pgroonga with schema extensions;

create table public.post_chunks (
  id uuid primary key default extensions.gen_random_uuid(),
  article_id uuid not null references public.articles (id) on delete cascade,
  chunk_index int not null check (chunk_index >= 0),
  heading_path text not null default '',
  content text not null,
  token_count int not null check (token_count >= 0),
  embedding extensions.vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (article_id, chunk_index)
);

create trigger post_chunks_set_updated_at
  before update on public.post_chunks
  for each row execute function extensions.moddatetime(updated_at);

-- post_chunks はEdge Function(service role)専用。anon/authenticatedには
-- テーブル権限を一切付与しない(RLSと二重の防御)。
grant select, insert, update, delete on public.post_chunks to service_role;

alter table public.post_chunks enable row level security;
-- ポリシーなし = service role以外からは常に拒否。

create index post_chunks_embedding_idx
  on public.post_chunks using hnsw (embedding extensions.vector_cosine_ops);

create index post_chunks_content_pgroonga_idx
  on public.post_chunks using pgroonga (content);
