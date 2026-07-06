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
  before insert on public.profiles
  for each row execute function public.set_commission_code();

create or replace function public.protect_profile_columns()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    if new.role is distinct from old.role
       or new.commission_code is distinct from old.commission_code then
      raise exception
        'role and commission_code can only be changed by an admin';
    end if;
  end if;
  return new;
end;
$$;

create trigger a_protect_profile_columns
  before update on public.profiles
  for each row execute function public.protect_profile_columns();
