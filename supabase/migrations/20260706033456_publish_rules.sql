create or replace function public.enforce_publish_rules()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  interval_days int;
  last_pub timestamptz;
begin
  -- run only when the row is becoming published
  if new.status = 'published'
     and (tg_op = 'INSERT' or old.status = 'draft') then

    if new.published_at is null then
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
  return new;
end;
$$;

create trigger b_enforce_publish_rules
  before insert or update on public.articles
  for each row execute function public.enforce_publish_rules();
