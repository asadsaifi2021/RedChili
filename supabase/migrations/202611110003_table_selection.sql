create function public.list_order_tables()
returns table (id uuid, label text)
language sql stable security definer set search_path = ''
as $$
  select id, label from public.dining_tables where active order by label;
$$;

create function public.submit_selected_order(p_table_id uuid, p_key uuid, p_lines jsonb)
returns bigint
language sql security definer set search_path = ''
as $$
  select public.submit_order(
    (select token from public.dining_tables where id = p_table_id),
    p_key,
    p_lines
  );
$$;

create function public.selected_order_receipt(p_table_id uuid, p_key uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select public.guest_receipt(
    (select token from public.dining_tables where id = p_table_id),
    p_key
  );
$$;

revoke all on function public.list_order_tables(), public.submit_selected_order(uuid, uuid, jsonb),
  public.selected_order_receipt(uuid, uuid) from public;
grant execute on function public.list_order_tables(), public.submit_selected_order(uuid, uuid, jsonb),
  public.selected_order_receipt(uuid, uuid) to anon, authenticated;
