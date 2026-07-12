-- 公開するにはbody(ブロック配列)にテキストを持つノードが1つ以上必要とする。
-- これは画像/ファイル/埋め込みのホスト制限(enforce_body_image_rules/
-- enforce_body_embed_rules)と同じく、body の内容整合性そのものの不変条件
-- であり admin にもサービスロールにも常に適用する(POST_INTERVAL_NOT_ELAPSED
-- のような「ワークフローポリシー」ではない)。

create or replace function public.body_has_text(body jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  node jsonb;
begin
  if jsonb_typeof(body) = 'array' then
    for node in select * from jsonb_array_elements(body) loop
      if node ->> 'type' = 'text' and coalesce(node ->> 'text', '') <> '' then
        return true;
      end if;
      if node ? 'content' and public.body_has_text(node -> 'content') then
        return true;
      end if;
    end loop;
  end if;
  return false;
end;
$$;

-- 20260706043424_harden_publish_and_commission_rules.sql の enforce_publish_rules
-- を完全に再現した上で、公開遷移の先頭にBODY_EMPTY_ON_PUBLISHチェックを追加する。
create or replace function public.enforce_publish_rules()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  interval_days int;
  last_pub timestamptz;
  trusted boolean;
begin
  trusted := (auth.uid() is null or public.is_admin());

  if new.status = 'published'
     and (tg_op = 'INSERT' or old.status = 'draft') then

    if not public.body_has_text(new.body) then
      raise exception 'BODY_EMPTY_ON_PUBLISH';
    end if;

    if trusted then
      if new.published_at is null then
        new.published_at := now();
      end if;
    else
      new.published_at := now();
    end if;

    if new.commissioned_by is null then
      select post_interval_days into interval_days
        from settings where id = 1;

      select max(published_at) into last_pub
        from articles
       where author_id = new.author_id
         and status = 'published'
         and commissioned_by is null
         and id <> new.id;

      if last_pub is not null
         and last_pub > now() - make_interval(days => interval_days) then
        raise exception
          'POST_INTERVAL_NOT_ELAPSED: next normal post allowed after %',
          last_pub + make_interval(days => interval_days);
      end if;
    end if;
  end if;

  if tg_op = 'UPDATE'
     and old.status = 'published' and new.status = 'published' then

    if not trusted then
      new.published_at := old.published_at;
    end if;

    if old.commissioned_by is not null
       and new.commissioned_by is null
       and not trusted then
      raise exception
        'COMMISSION_UNLINK_REQUIRES_UNPUBLISH: unpublish the article before removing the commission link';
    end if;
  end if;

  return new;
end;
$$;
