-- プロバイダーの「認定」フラグ。認定された provider のみ主要サービス情報を公開できる想定
-- (公開サイト側の表示は別タスク)。admin のみが切り替えられる。
alter table public.profiles
  add column certified boolean not null default false;

create or replace function public.protect_profile_columns()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    if new.role is distinct from old.role
       or new.certified is distinct from old.certified then
      raise exception 'role and certified can only be changed by an admin';
    end if;
  end if;
  return new;
end;
$$;
