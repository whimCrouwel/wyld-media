create or replace function public.resolve_commission_code()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  provider_id uuid;
begin
  if new.commission_code_input is null then
    new.commissioned_by := null;
  elsif tg_op = 'INSERT'
        or new.commission_code_input is distinct from old.commission_code_input then
    select id into provider_id
      from profiles
     where commission_code = new.commission_code_input
       and role = 'provider';
    if provider_id is null then
      raise exception 'INVALID_COMMISSION_CODE: no provider matches this code';
    end if;
    new.commissioned_by := provider_id;
  else
    new.commissioned_by := old.commissioned_by;
  end if;
  return new;
end;
$$;

create trigger a_resolve_commission_code
  before insert or update on public.articles
  for each row execute function public.resolve_commission_code();

create or replace function public.validate_commission_code(code text)
returns text
language sql stable security definer
set search_path = public
as $$
  select name from profiles
   where commission_code = code and role = 'provider';
$$;

revoke execute on function public.validate_commission_code(text) from public, anon;
grant execute on function public.validate_commission_code(text)
  to authenticated, service_role;
