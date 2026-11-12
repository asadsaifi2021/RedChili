alter table public.staff add column require_mfa boolean not null default false;
update public.staff set require_mfa = true where role = 'cashier';

create or replace function public.staff_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.staff
  where id = auth.uid() and (not require_mfa or auth.jwt()->>'aal' = 'aal2')
$$;

create function public.staff_login_policy() returns boolean
language sql stable security definer set search_path = '' as $$
  select require_mfa from public.staff where id = auth.uid()
$$;
revoke all on function public.staff_login_policy() from public, anon;
grant execute on function public.staff_login_policy() to authenticated;
