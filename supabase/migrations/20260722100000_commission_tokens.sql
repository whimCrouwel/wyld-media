-- 依頼トークン(プロバイダー→ライター)。1トークン=1記事の使い切り。
-- 詳細: docs/superpowers/specs/2026-07-22-commission-token-design.md

create table public.commission_tokens (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.profiles (id),
  writer_id uuid not null references public.profiles (id),
  token text not null unique,
  created_at timestamptz not null default now(),
  constraint commission_tokens_token_format
    check (token ~ '^WM-[0-9A-F]{8}$')
);

create or replace function public.set_commission_token()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  provider_role public.user_role;
  writer_role public.user_role;
begin
  -- provider_id はクライアント指定を無視し、必ず呼び出し本人にする
  new.provider_id := auth.uid();

  select role into provider_role from profiles where id = new.provider_id;
  if provider_role is distinct from 'provider' then
    raise exception 'NOT_A_PROVIDER: only providers can issue commission tokens';
  end if;

  select role into writer_role from profiles where id = new.writer_id;
  if writer_role is distinct from 'writer' then
    raise exception 'INVALID_WRITER: target profile is not a writer';
  end if;

  new.token := 'WM-' || upper(encode(extensions.gen_random_bytes(4), 'hex'));
  return new;
end;
$$;

create trigger a_set_commission_token
  before insert on public.commission_tokens
  for each row execute function public.set_commission_token();

alter table public.commission_tokens enable row level security;

grant select, insert on public.commission_tokens to authenticated;

create policy "see own issued or received tokens, admin sees all"
  on public.commission_tokens for select to authenticated
  using (provider_id = auth.uid() or writer_id = auth.uid() or public.is_admin());

create policy "provider issues own tokens"
  on public.commission_tokens for insert to authenticated
  with check (provider_id = auth.uid());

-- プロバイダーが依頼先ライターを選べるよう、ライターの基本情報を全認証ユーザーに公開する。
-- 公開サイトで既に同じ情報が誰でも見られるため、新たな情報漏えいにはならない。
create policy "authenticated reads writer profiles"
  on public.profiles for select to authenticated
  using (role = 'writer');
