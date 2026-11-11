-- The random checkout key grants access to one receipt. Order numbers and table
-- QR codes alone do not grant access to receipts or expose other guests' orders.
create function public.guest_receipt(p_token uuid, p_key uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'number', orders.number,
    'table_label', orders.table_label,
    'items', orders.items,
    'total', orders.total,
    'status', case
      when orders.cancelled_at is not null then 'cancelled'
      when orders.paid_at is not null then 'paid'
      when orders.printed_revision = orders.revision then 'kitchen'
      else 'received'
    end
  )
  from public.orders
  join public.dining_tables on dining_tables.id = orders.table_id
  where dining_tables.token = p_token and orders.request_key = p_key;
$$;

revoke all on function public.guest_receipt(uuid, uuid) from public;
grant execute on function public.guest_receipt(uuid, uuid) to anon, authenticated;
