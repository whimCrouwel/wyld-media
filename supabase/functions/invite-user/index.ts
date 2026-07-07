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
  let payload: { email?: string; name?: string; slug?: string; role?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  const { email, name, slug, role } = payload;
  if (
    !email || !name || !slug ||
    !['writer', 'provider'].includes(role ?? '') ||
    !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)
  ) {
    return json(
      { error: 'email, name, slug, and role (writer|provider) are required' },
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
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(invited.user.id);
    return json({ error: profileError.message }, 400);
  }

  return json({ ok: true, userId: invited.user.id });
});
