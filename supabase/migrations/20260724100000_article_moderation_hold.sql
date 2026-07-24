-- Admin accounts do not author articles (that requires a separate writer
-- account -- role is a single enum per profile). Admin's article-facing
-- capability is auditing: place a moderation hold that hides an article
-- from the public site regardless of status, independent of (and not
-- reversible by) the writer's own draft/published toggle.

alter table public.articles
  add column moderation_hold boolean not null default false,
  add column moderation_hold_at timestamptz,
  add column moderation_hold_by uuid references public.profiles (id),
  add column moderation_hold_reason text;

create or replace function public.protect_moderation_hold_columns()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.moderation_hold is distinct from old.moderation_hold
     or new.moderation_hold_at is distinct from old.moderation_hold_at
     or new.moderation_hold_by is distinct from old.moderation_hold_by
     or new.moderation_hold_reason is distinct from old.moderation_hold_reason then
    if not public.is_admin() then
      raise exception
        'moderation_hold can only be changed by an admin';
    end if;
  end if;

  -- server-stamp who/when instead of trusting client-supplied values
  if new.moderation_hold is distinct from old.moderation_hold then
    if new.moderation_hold then
      if coalesce(btrim(new.moderation_hold_reason), '') = '' then
        raise exception 'moderation_hold requires a reason';
      end if;
      new.moderation_hold_at := now();
      new.moderation_hold_by := auth.uid();
    else
      new.moderation_hold_at := null;
      new.moderation_hold_by := null;
      new.moderation_hold_reason := null;
    end if;
  end if;

  return new;
end;
$$;

create trigger a_protect_moderation_hold_columns
  before update on public.articles
  for each row execute function public.protect_moderation_hold_columns();

-- Close the admin insert bypass now that admin no longer authors articles.
drop policy "insert own articles as writer or admin" on public.articles;
create policy "insert own articles as writer"
  on public.articles for insert to authenticated
  with check (author_id = auth.uid() and public.is_writer());
