create table public.staff (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('cashier','admin'))
);
create table public.dining_tables (
  id uuid primary key default gen_random_uuid(),
  label text unique not null check (length(trim(label)) between 1 and 30),
  token uuid unique not null default gen_random_uuid(),
  active boolean not null default true
);
create table public.menu_items (
  id text primary key default gen_random_uuid()::text,
  category text not null check (category in ('new','grills','sides','appetizers','mini','drinks')),
  name_ar text not null check (length(trim(name_ar)) between 1 and 100),
  name_en text not null check (length(trim(name_en)) between 1 and 100),
  description_ar text not null default '',
  description_en text not null default '',
  price integer not null check (price between 1 and 1000000),
  calories integer check (calories between 0 and 10000),
  prep_minutes integer check (prep_minutes between 1 and 1440),
  allergens_ar text not null default '',
  allergens_en text not null default '',
  photo text not null default '',
  available boolean not null default true,
  published boolean not null default true,
  position integer not null default 0
);
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity unique,
  table_id uuid not null references public.dining_tables,
  table_label text not null,
  request_key uuid unique not null,
  request_lines jsonb not null,
  items jsonb not null,
  total integer not null,
  revision integer not null default 1,
  printed_revision integer not null default 0,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  paid_by uuid references auth.users,
  payment_method text,
  payment_batch uuid,
  cancelled_at timestamptz
);
create index orders_table_created on public.orders(table_id, created_at desc);
create index orders_recent on public.orders(created_at desc);
create table public.order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders,
  actor uuid references auth.users,
  action text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create function public.staff_role() returns text language sql stable security definer set search_path = '' as $$
  select role from public.staff where id = auth.uid() and auth.jwt()->>'aal' = 'aal2'
$$;
revoke all on function public.staff_role() from public;
grant execute on function public.staff_role() to anon, authenticated;

alter table public.staff enable row level security;
alter table public.dining_tables enable row level security;
alter table public.menu_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_events enable row level security;
revoke all on public.staff, public.dining_tables, public.menu_items, public.orders, public.order_events from anon, authenticated;
grant select on public.menu_items to anon, authenticated;
grant insert, update on public.menu_items, public.dining_tables to authenticated;
grant select on public.dining_tables, public.orders, public.order_events to authenticated;
create policy menu_read on public.menu_items for select using (published or public.staff_role() = 'admin');
create policy menu_insert on public.menu_items for insert to authenticated with check (public.staff_role() = 'admin');
create policy menu_update on public.menu_items for update to authenticated using (public.staff_role() = 'admin') with check (public.staff_role() = 'admin');
create policy table_read on public.dining_tables for select to authenticated using (public.staff_role() = 'admin');
create policy table_insert on public.dining_tables for insert to authenticated with check (public.staff_role() = 'admin');
create policy table_update on public.dining_tables for update to authenticated using (public.staff_role() = 'admin') with check (public.staff_role() = 'admin');
create policy orders_read on public.orders for select to authenticated using (public.staff_role() in ('cashier','admin'));
create policy events_read on public.order_events for select to authenticated using (public.staff_role() in ('cashier','admin'));
alter publication supabase_realtime add table public.orders;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('menu-photos','menu-photos',true,3000000,array['image/jpeg','image/png','image/webp']);
create policy menu_photo_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'menu-photos' and public.staff_role() = 'admin');

create function public.resolve_table(p_token uuid) returns text language sql stable security definer set search_path = '' as $$
  select label from public.dining_tables where token=p_token and active
$$;

-- Materialize immutable kitchen and price details, preserving existing prices on staff edits.
create function public.price_lines(p_lines jsonb, p_previous jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  line jsonb; item public.menu_items; prior jsonb; result jsonb := '[]';
  quantity integer; note text; item_id text; seen text[] := '{}';
begin
  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'invalid_cart'; end if;
  if jsonb_array_length(p_lines) not between 1 and 45 then raise exception 'invalid_cart'; end if;
  for line in select value from jsonb_array_elements(p_lines) loop
    item_id := line->>'id';
    if item_id is null or item_id = any(seen) then raise exception 'invalid_item'; end if;
    seen := array_append(seen,item_id);
    quantity := (line->>'quantity')::integer;
    note := trim(coalesce(line->>'note',''));
    if quantity is null or quantity not between 1 and 25 or length(note)>240 then raise exception 'invalid_quantity_or_note'; end if;
    select value into prior from jsonb_array_elements(p_previous) where value->>'id'=item_id;
    if prior is null then
      select * into item from public.menu_items where id=item_id and published and available for share;
      if not found then raise exception 'item_unavailable'; end if;
      if p_previous is null and (line->>'price')::integer is distinct from item.price then raise exception 'price_changed'; end if;
      prior := jsonb_build_object('id',item.id,'name_ar',item.name_ar,'name_en',item.name_en,'price',item.price);
    end if;
    result := result || jsonb_build_array(prior || jsonb_build_object('quantity',quantity,'note',note));
  end loop;
  return result;
end $$;

create function public.submit_order(p_token uuid, p_key uuid, p_lines jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare tbl public.dining_tables; saved public.orders; priced jsonb; amount integer;
begin
  if p_key is null then raise exception 'invalid_request'; end if;
  select * into tbl from public.dining_tables where token=p_token and active for update;
  if not found then raise exception 'invalid_table'; end if;
  select * into saved from public.orders where request_key=p_key;
  if found then
    if saved.table_id <> tbl.id or saved.request_lines <> p_lines then raise exception 'invalid_request'; end if;
    return saved.number;
  end if;
  if (select count(*) from public.orders where table_id=tbl.id and created_at>now()-interval '1 minute') >= 10 then
    raise exception 'too_many_orders';
  end if;
  priced := public.price_lines(p_lines,null);
  select sum((value->>'quantity')::int * (value->>'price')::int) into amount from jsonb_array_elements(priced);
  insert into public.orders(table_id,table_label,request_key,request_lines,items,total)
    values(tbl.id,tbl.label,p_key,p_lines,priced,amount) returning * into saved;
  return saved.number;
end $$;

create function public.change_order(p_id uuid,p_revision integer,p_action text,p_lines jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
declare saved public.orders; priced jsonb; amount integer;
begin
  if coalesce(public.staff_role(),'') not in ('cashier','admin') then raise exception 'staff_required'; end if;
  select * into saved from public.orders where id=p_id;
  if not found then raise exception 'order_missing'; end if;
  perform 1 from public.dining_tables where id=saved.table_id for update;
  select * into saved from public.orders where id=p_id for update;
  if p_revision is distinct from saved.revision then raise exception 'order_changed'; end if;
  if p_action='print' then
    update public.orders set printed_revision=revision where id=p_id;
  elsif saved.paid_at is null and saved.cancelled_at is null and p_action='edit' then
    priced := public.price_lines(p_lines,saved.items);
    select sum((value->>'quantity')::int*(value->>'price')::int) into amount from jsonb_array_elements(priced);
    update public.orders set items=priced,total=amount,revision=revision+1 where id=p_id;
  elsif saved.paid_at is null and saved.cancelled_at is null and p_action='cancel' then
    update public.orders set cancelled_at=now(),revision=revision+1 where id=p_id;
  else raise exception 'order_closed';
  end if;
  insert into public.order_events(order_id,actor,action,details)
    values(p_id,auth.uid(),p_action,jsonb_build_object('revision',saved.revision,'previous_items',case when p_action='edit' then saved.items end,'items',priced));
end $$;

create function public.pay_table(p_table uuid,p_expected jsonb,p_method text) returns void
language plpgsql security definer set search_path = '' as $$
declare current_orders jsonb; batch uuid := gen_random_uuid();
begin
  if coalesce(public.staff_role(),'') not in ('cashier','admin') then raise exception 'staff_required'; end if;
  if p_method is null or p_method not in ('cash','card','other') then raise exception 'invalid_method'; end if;
  perform 1 from public.dining_tables where id=p_table for update;
  select jsonb_object_agg(id,revision) into current_orders from public.orders
    where table_id=p_table and paid_at is null and cancelled_at is null;
  if current_orders is null or current_orders is distinct from p_expected then raise exception 'bill_changed'; end if;
  with paid as (
    update public.orders set paid_at=now(),paid_by=auth.uid(),payment_method=p_method,payment_batch=batch
    where table_id=p_table and paid_at is null and cancelled_at is null returning id
  )
  insert into public.order_events(order_id,actor,action,details)
    select id,auth.uid(),'paid',jsonb_build_object('method',p_method,'batch',batch) from paid;
end $$;

revoke all on function public.resolve_table(uuid), public.submit_order(uuid,uuid,jsonb), public.price_lines(jsonb,jsonb),
  public.change_order(uuid,integer,text,jsonb), public.pay_table(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.resolve_table(uuid),public.submit_order(uuid,uuid,jsonb) to anon,authenticated;
grant execute on function public.change_order(uuid,integer,text,jsonb),public.pay_table(uuid,jsonb,text) to authenticated;
