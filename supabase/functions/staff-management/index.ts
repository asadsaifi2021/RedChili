import { createClient } from 'npm:@supabase/supabase-js@2';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { headers });
  if (request.method !== 'POST') return reply({ error: 'method' }, 405);
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return reply({ error: 'unauthorized' }, 401);
  const url = Deno.env.get('SUPABASE_URL')!;
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: role, error: accessError } = await caller.rpc('staff_role');
  if (accessError || role !== 'admin') return reply({ error: 'forbidden' }, 403);

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const body = await request.json().catch(() => null);
  if (body?.action === 'list') {
    const { data, error } = await admin.from('staff').select('id,role,require_mfa').order('role');
    if (error) return reply({ error: 'list_failed' }, 500);
    const accounts = await Promise.all(data.map(async row => {
      const { data: account, error: lookupError } = await admin.auth.admin.getUserById(row.id);
      if (lookupError) throw lookupError;
      return { ...row, email: account.user.email };
    })).catch(() => null);
    return accounts ? reply({ accounts }) : reply({ error: 'list_failed' }, 500);
  }
  if (body?.action === 'create') {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email || typeof body.password !== 'string' || body.password.length < 12 ||
      !['admin', 'cashier'].includes(body.role) || typeof body.require_mfa !== 'boolean') {
      return reply({ error: 'invalid_account' }, 400);
    }
    const { data, error } = await admin.auth.admin.createUser({
      email, password: body.password, email_confirm: true,
    });
    if (error || !data.user) return reply({ error: 'create_failed' }, 400);
    const { error: roleError } = await admin.from('staff').insert({
      id: data.user.id, role: body.role, require_mfa: body.require_mfa,
    });
    if (roleError) {
      await admin.auth.admin.deleteUser(data.user.id);
      return reply({ error: 'create_failed' }, 500);
    }
    return reply({ ok: true }, 201);
  }
  if (body?.action === 'mfa' && typeof body.id === 'string' && typeof body.require_mfa === 'boolean') {
    const { error } = await admin.from('staff').update({ require_mfa: body.require_mfa }).eq('id', body.id).select('id').single();
    return error ? reply({ error: 'update_failed' }, 400) : reply({ ok: true });
  }
  return reply({ error: 'invalid_action' }, 400);
});
