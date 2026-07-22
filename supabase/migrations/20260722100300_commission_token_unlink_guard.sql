-- COMMISSION_UNLINK_REQUIRES_UNPUBLISH は commission_token_id の変更も同時に見るよう拡張する。
-- 詳細: docs/superpowers/specs/2026-07-22-commission-token-design.md:71

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
       and not trusted
       and (new.commissioned_by is null
            or new.commissioned_by is distinct from old.commissioned_by
            or new.commission_token_id is distinct from old.commission_token_id)
    then
      raise exception
        'COMMISSION_UNLINK_REQUIRES_UNPUBLISH: unpublish the article before removing the commission link';
    end if;
  end if;

  return new;
end;
$$;
