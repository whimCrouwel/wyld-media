-- プロバイダーが同じライターへ依頼を連発できないよう、最短依頼間隔を強制する。
-- 記事公開間隔(post_interval_days)と同じ考え方だが、依頼トークン発行は別の業務なので
-- 専用のカラムで管理する。取消済みトークンは間隔のカウント対象外(依頼を取り消した
-- ケースまで足止めする理由がないため)。

alter table public.settings
  add column commission_interval_days int not null default 10
    check (commission_interval_days >= 0);

create or replace function public.set_commission_token()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  provider_role public.user_role;
  writer_role public.user_role;
  interval_days int;
  last_issued timestamptz;
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

  select commission_interval_days into interval_days from settings where id = 1;
  select max(created_at) into last_issued
    from commission_tokens
   where provider_id = new.provider_id
     and writer_id = new.writer_id
     and revoked_at is null;
  if last_issued is not null
     and last_issued > now() - make_interval(days => interval_days) then
    raise exception
      'COMMISSION_INTERVAL_NOT_ELAPSED: must wait until %', last_issued + make_interval(days => interval_days);
  end if;

  new.token := 'WM-' || upper(encode(extensions.gen_random_bytes(4), 'hex'));
  return new;
end;
$$;
