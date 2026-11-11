import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('QR checkout, staff authorization, revisioned ticket and combined payment', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        'select nullif(current_setting(''test.user'',true),'''')::uuid';
      create function auth.jwt() returns jsonb language sql stable as
        'select jsonb_build_object(''aal'',current_setting(''test.aal'',true))';
      create table storage.buckets(id text,name text,public boolean,file_size_limit int,allowed_mime_types text[]);
      create table storage.objects(id text,bucket_id text);
      create publication supabase_realtime;
    `);
    await db.exec(readFileSync('supabase/migrations/202611110001_ordering.sql','utf8'));
    await db.exec(readFileSync('supabase/migrations/202611110002_guest_receipt.sql','utf8'));
    await db.exec(readFileSync('supabase/seed.sql','utf8'));
    const cashier = randomUUID(), admin = randomUUID();
    await db.query('insert into auth.users values ($1),($2)', [cashier, admin]);
    await db.query("insert into public.staff values ($1,'cashier'),($2,'admin')", [cashier, admin]);
    const { rows: [table] } = await db.query("insert into public.dining_tables(label) values ('7') returning *");
    const lines = JSON.stringify([{ id: 'dish-1', quantity: 2, price: 4400, note: 'بدون بصل' }]);
    const request = randomUUID();
    const submit = (key, body = lines, token = table.token) =>
      db.query('select public.submit_order($1,$2,$3) as number', [token, key, body]);
    await db.exec('set role anon');
    const { rows: [{ count }] } = await db.query('select count(*) from public.menu_items');
    assert.equal(Number(count), 45);
    await assert.rejects(db.query('select * from public.orders'), /permission denied/);
    await assert.rejects(submit(request, lines, randomUUID()), /invalid_table/);
    await assert.rejects(submit(request, lines.replace('4400','1')), /price_changed/);
    const { rows: [first] } = await submit(request);
    const receipt = async (token, key) => (await db.query('select public.guest_receipt($1,$2) as receipt', [token, key])).rows[0].receipt;
    assert.equal((await receipt(table.token, request)).status, 'received');
    assert.equal(await receipt(table.token, randomUUID()), null);
    assert.equal(await receipt(randomUUID(), request), null);
    assert.deepEqual((await submit(request)).rows, [first]);
    await assert.rejects(submit(request, lines.replace('"quantity":2','"quantity":3')), /invalid_request/);
    await submit(randomUUID());
    await db.exec('reset role; set role authenticated');
    const impersonate = (id, aal) => db.query("select set_config('test.user',$1,false),set_config('test.aal',$2,false)", [id, aal]);
    await impersonate(cashier,'aal1');
    assert.equal((await db.query('select * from public.orders')).rows.length, 0);
    await impersonate(cashier,'aal2');
    const { rows: orders } = await db.query('select * from public.orders order by number');
    assert.equal(orders.length, 2);
    assert.equal(orders[0].total, 8800);
    assert.equal((await db.query("update public.menu_items set price=9999 where id='dish-1'")).affectedRows, 0);
    await impersonate(admin,'aal2');
    assert.equal((await db.query("update public.menu_items set price=4500 where id='dish-1'")).affectedRows, 1);
    await impersonate(cashier,'aal2');
    const id = orders[0].id;
    await db.query("select public.change_order($1,1,'edit',$2)", [id, lines.replace('"quantity":2','"quantity":3')]);
    await assert.rejects(db.query("select public.change_order($1,1,'print')", [id]), /order_changed/);
    await db.query("select public.change_order($1,2,'print')", [id]);
    const { rows: [updated] } = await db.query('select * from public.orders where id=$1', [id]);
    assert.equal(updated.total, 13200);
    assert.equal(updated.printed_revision, 2);
    assert.equal((await receipt(table.token, request)).status, 'kitchen');
    await assert.rejects(db.query("select public.pay_table($1,$2,'card')", [table.id, '{}']), /bill_changed/);
    const bill = JSON.stringify({ [id]: 2, [orders[1].id]: 1 });
    await db.query("select public.pay_table($1,$2,'card')", [table.id, bill]);
    const { rows: paid } = await db.query('select * from public.orders');
    assert.ok(paid.every(order => order.paid_at && order.paid_by === cashier && order.payment_batch === paid[0].payment_batch));
    assert.deepEqual((await db.query('select action from public.order_events order by id')).rows.map(row => row.action), ['edit','print','paid','paid']);
    await db.exec('reset role; set role anon');
    const paidReceipt = await receipt(table.token, request);
    assert.equal(paidReceipt.status, 'paid');
    assert.equal(paidReceipt.total, 13200);
    assert.deepEqual(Object.keys(paidReceipt).sort(), ['items', 'number', 'status', 'table_label', 'total']);
  } finally { await db.close(); }
});
