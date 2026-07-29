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

  // validate payload
  let payload: {
    email?: string; name?: string; slug?: string; role?: string; certified?: boolean; region?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  const { email, name, slug, role, certified, region } = payload;
  // profiles.region の check 制約と同じ12区分。制約を変えるときは admin/src/lib/regions.ts と併せて更新する。
  const REGIONS = [
    '北海道', '東北', '関東', '甲信越', '北陸', '東海',
    '近畿', '中国', '四国', '九州', '沖縄', '海外',
  ];
  if (
    !email || !name || !slug ||
    !['writer', 'provider'].includes(role ?? '') ||
    !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) ||
    (certified !== undefined && typeof certified !== 'boolean') ||
    (certified && role !== 'provider') ||
    // 招待メール送信後に profile insert が制約違反で失敗するとロールバックになる(メールだけ届く)ので、ここで先に弾く
    (region !== undefined && !REGIONS.includes(region))
  ) {
    return json(
      { error: 'email, name, slug, and role (writer|provider) are required; certified is only valid for provider; region must be one of the 12 areas' },
      400,
    );
  }

  // invite, then create the profile; roll back the auth user on failure
  // CMS_URL must be set to the admin subdomain in production; the invite link lands on /set-password.
  const cmsUrl = Deno.env.get('CMS_URL') ?? 'http://localhost:4322';
  const { data: invited, error: inviteError } =
    await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${cmsUrl}/set-password` });
  if (inviteError) return json({ error: inviteError.message }, 400);

  const { error: profileError } = await admin.from('profiles').insert({
    id: invited.user.id,
    role,
    slug,
    name,
    certified: role === 'provider' ? !!certified : false,
    region: region ?? null,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(invited.user.id);
    return json({ error: profileError.message }, 400);
  }

  return json({ ok: true, userId: invited.user.id });
});
