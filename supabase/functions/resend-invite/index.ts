import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // identify the caller and require the admin role
  const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  const { data: callerData } = await admin.auth.getUser(jwt);
  if (!callerData?.user) return json({ error: 'unauthorized' }, 401);

  const { data: callerProfile } = await admin
    .from('profiles')
    .select('role')
    .eq('id', callerData.user.id)
    .single();
  if (callerProfile?.role !== 'admin') return json({ error: 'forbidden' }, 403);

  let payload: { userId?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  const { userId } = payload;
  if (!userId) return json({ error: 'userId is required' }, 400);

  const { data: target, error: targetError } = await admin.auth.admin.getUserById(userId);
  if (targetError || !target?.user) return json({ error: 'user not found' }, 404);
  if (target.user.confirmed_at) return json({ error: 'already confirmed' }, 400);
  const email = target.user.email;
  if (!email) return json({ error: 'user has no email' }, 400);

  // invite-user と同じ redirect 先。未確認(=一度も招待リンクを完了していない)ユーザーへの再送は
  // inviteUserByEmail を呼び直すだけでよい(GoTrue が新しいリンク/トークンを発行し直す)。
  // 既に確認済みのユーザーには使えない(GoTrue が "already registered" を返す)ので、上で先に弾く。
  const cmsUrl = Deno.env.get('CMS_URL') ?? 'http://localhost:4322';
  const { error: inviteError } =
    await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${cmsUrl}/set-password` });
  if (inviteError) return json({ error: inviteError.message }, 400);

  return json({ ok: true });
});
