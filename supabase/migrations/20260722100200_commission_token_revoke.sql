-- 依頼トークンの取消(revoke)。未使用のトークンのみ、発行元プロバイダーまたは admin が取消可能。
-- 詳細: docs/superpowers/specs/2026-07-22-commission-token-design.md

alter table public.commission_tokens
  add column revoked_at timestamptz,
  add column revoked_by uuid references public.profiles (id);

create or replace function public.resolve_commission_token()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  tok record;
begin
  if new.commission_token_input is null then
    new.commissioned_by := null;
    new.commission_token_id := null;
  elsif tg_op = 'INSERT'
        or new.commission_token_input is distinct from old.commission_token_input then
    select id, provider_id, writer_id, revoked_at into tok
      from commission_tokens
     where token = new.commission_token_input;

    if tok.id is null then
      raise exception 'INVALID_COMMISSION_TOKEN: no token matches this value';
    end if;
    if tok.revoked_at is not null then
      raise exception 'COMMISSION_TOKEN_REVOKED: this token has been revoked';
    end if;
    if tok.writer_id <> new.author_id then
      raise exception 'COMMISSION_TOKEN_WRONG_WRITER: this token was issued to a different writer';
    end if;
    if exists (
      select 1 from articles
       where commission_token_id = tok.id and id <> new.id
    ) then
      raise exception 'COMMISSION_TOKEN_ALREADY_USED: this token has already been used on another article';
    end if;

    new.commissioned_by := tok.provider_id;
    new.commission_token_id := tok.id;
  else
    new.commissioned_by := old.commissioned_by;
    new.commission_token_id := old.commission_token_id;
  end if;
  return new;
end;
$$;

create or replace function public.validate_commission_token(token text, article_id uuid default null)
returns text
language sql stable security definer
set search_path = public
as $$
  select p.name
    from commission_tokens t
    join profiles p on p.id = t.provider_id
   where t.token = validate_commission_token.token
     and t.writer_id = auth.uid()
     and t.revoked_at is null
     and not exists (
       select 1 from articles a
        where a.commission_token_id = t.id
          and a.id is distinct from article_id
     );
$$;

create or replace function public.guard_commission_token_revoke()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.token is distinct from old.token
     or new.provider_id is distinct from old.provider_id
     or new.writer_id is distinct from old.writer_id
     or new.created_at is distinct from old.created_at then
    raise exception 'COMMISSION_TOKEN_IMMUTABLE: only revoked_at can be changed';
  end if;

  if old.revoked_at is not null then
    raise exception 'COMMISSION_TOKEN_ALREADY_REVOKED: this token has already been revoked';
  end if;

  if new.revoked_at is null then
    return new;
  end if;

  if exists (
    select 1 from articles where commission_token_id = old.id
  ) then
    raise exception 'TOKEN_IN_USE_CANNOT_REVOKE: a token already linked to an article cannot be revoked';
  end if;

  new.revoked_at := now();
  new.revoked_by := auth.uid();
  return new;
end;
$$;

create trigger a_guard_commission_token_revoke
  before update on public.commission_tokens
  for each row execute function public.guard_commission_token_revoke();

grant update on public.commission_tokens to authenticated;

create policy "provider or admin revokes a token"
  on public.commission_tokens for update to authenticated
  using (provider_id = auth.uid() or public.is_admin())
  with check (provider_id = auth.uid() or public.is_admin());
