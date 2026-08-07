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

  // auth.users は service role でしか読めない(CMS は anon key のみ保持)。招待メールへの
  // 反応(メール確認・最終ログイン)を /users 一覧のバッジに出すため、admin だけに限定して集約する。
  const status: Record<string, { confirmed: boolean; lastSignInAt: string | null }> = {};
  const perPage = 200;
  // 想定ユーザー数は小規模(社内 CMS)。ページングの取りこぼし・無限ループ対策に上限を設ける。
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) return json({ error: error.message }, 500);
    for (const u of data.users) {
      status[u.id] = {
        confirmed: !!u.confirmed_at,
        lastSignInAt: u.last_sign_in_at ?? null,
      };
    }
    if (data.users.length < perPage) break;
  }

  return json(status);
});
