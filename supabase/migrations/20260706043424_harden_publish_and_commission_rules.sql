-- Harden publish rules and commission-code lifecycle per final-review findings.
--
-- "Trusted" callers are defined as: auth.uid() is null or public.is_admin().
-- pgTAP fixtures run as postgres with no JWT sub (auth.uid() is null), and the
-- static-site builder / service scripts run with the service key (also no JWT
-- sub) -- both are trusted by design, same as admins.
--
-- INVARIANT this relies on: untrusted client writers ALWAYS present a non-null
-- auth.uid() (PostgREST only assigns the authenticated role to a GoTrue JWT,
-- which always carries sub; anon has no write grants). Server-side code must
-- never write articles on a user's behalf with a bare service_role client --
-- doing so would be "trusted" and silently bypass these guards.

-- Fix 1 + Fix 3: make published_at server-authoritative for untrusted callers,
-- and forbid unlinking a commission from a still-published article.
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

  -- run only when the row is becoming published
  if new.status = 'published'
     and (tg_op = 'INSERT' or old.status = 'draft') then

    if trusted then
      if new.published_at is null then
        new.published_at := now();
      end if;
    else
      -- ignore any client-supplied published_at on the publish transition
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

  -- row stays published across the update: published_at is immutable for
  -- untrusted callers, and unlinking a commission requires unpublishing first
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

-- Fix 2: auto-generate commission_code on role promotion (writer -> provider),
-- not just at insert time. Existing codes are never overwritten.
drop trigger if exists a_set_commission_code on public.profiles;

create or replace function public.set_commission_code()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.role = 'provider' and new.commission_code is null then
    new.commission_code :=
      'WM-' || upper(encode(extensions.gen_random_bytes(4), 'hex'));
  end if;
  return new;
end;
$$;

create trigger a_set_commission_code
  before insert or update on public.profiles
  for each row execute function public.set_commission_code();

-- Fix 4: commission_code format constraint (cheap sanity check).
alter table public.profiles
  add constraint profiles_commission_code_format
  check (commission_code is null or commission_code ~ '^WM-[0-9A-F]{8}$');
