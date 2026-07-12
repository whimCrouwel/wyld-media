-- 埋め込みブロックのurlを許可プロバイダドメインに限定する。
-- admin/src/lib/embed-dialog.ts の detectEmbedProvider と同じ6ホストを維持すること。

create or replace function public.enforce_body_embed_rules()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  allowed_embed_hosts constant text[] := array[
    'www.youtube.com', 'youtu.be', 'twitter.com', 'x.com', 'player.vimeo.com', 'vimeo.com'
  ];
  embed_urls text[];
  u text;
  host text;
begin
  if tg_op = 'UPDATE' and new.body is not distinct from old.body then
    return new;
  end if;

  -- select 内で "u" をそのままテーブルエイリアスにすると、同名の plpgsql 変数 u
  -- (下の foreach で使う)と衝突して "column reference is ambiguous" になる
  -- ため、エイリアスは別名にする(20260712090100_body_image_rules_jsonb.sql と同じ理由)。
  select array_agg(asset_url) into embed_urls from public.body_asset_urls(new.body, 'embed') as asset_url;
  if embed_urls is null then
    return new;
  end if;

  foreach u in array embed_urls loop
    host := lower((regexp_match(u, '^[a-zA-Z]+://([^/]+)'))[1]);
    if host is null or not (host = any(allowed_embed_hosts)) then
      raise exception 'EMBED_HOST_NOT_ALLOWED';
    end if;
  end loop;

  return new;
end;
$$;

create trigger aa_enforce_body_embed_rules
  before insert or update on public.articles
  for each row execute function public.enforce_body_embed_rules();
