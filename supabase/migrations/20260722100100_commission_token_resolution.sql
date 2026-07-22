-- 依頼トークンへの一本化: articles を新しいトークン方式に切り替え、
-- 旧・依頼者コード方式(profiles.commission_code 等)を撤去する。
-- 詳細: docs/superpowers/specs/2026-07-22-commission-token-design.md

alter table public.articles
  rename column commission_code_input to commission_token_input;

alter table public.articles
  add column commission_token_id uuid references public.commission_tokens (id),
  add constraint articles_commission_token_id_key unique (commission_token_id);

drop trigger if exists a_resolve_commission_code on public.articles;
drop function if exists public.resolve_commission_code();
drop function if exists public.validate_commission_code(text);

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
    select id, provider_id, writer_id into tok
      from commission_tokens
     where token = new.commission_token_input;

    if tok.id is null then
      raise exception 'INVALID_COMMISSION_TOKEN: no token matches this value';
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

create trigger a_resolve_commission_token
  before insert or update on public.articles
  for each row execute function public.resolve_commission_token();

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
     and not exists (
       select 1 from articles a
        where a.commission_token_id = t.id
          and a.id is distinct from article_id
     );
$$;

revoke execute on function public.validate_commission_token(text, uuid) from public, anon;
grant execute on function public.validate_commission_token(text, uuid)
  to authenticated, service_role;

-- 旧・依頼者コード方式の撤去
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    if new.role is distinct from old.role then
      raise exception 'role can only be changed by an admin';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists a_set_commission_code on public.profiles;
drop function if exists public.set_commission_code();

alter table public.profiles drop column commission_code;
