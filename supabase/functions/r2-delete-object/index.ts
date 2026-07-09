import { createClient } from 'npm:@supabase/supabase-js@2';
import { AwsClient } from 'npm:aws4fetch';
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
  const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  const { data: userData } = await admin.auth.getUser(jwt);
  if (!userData?.user) return json({ error: 'unauthorized' }, 401);

  let payload: { url?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  const publicBase = (Deno.env.get('R2_PUBLIC_BASE_URL') ?? '').replace(/\/$/, '');
  const url = payload.url ?? '';
  if (!publicBase || !url.startsWith(`${publicBase}/`)) {
    return json({ error: 'url must live under R2_PUBLIC_BASE_URL' }, 400);
  }

  const key = url.slice(publicBase.length + 1);
  // 自分の uid 配下のオブジェクトしか消せない。
  // r2-upload-url が発行するキーは `${uid}/${uuid}.${ext}`。
  if (!key.startsWith(`${userData.user.id}/`)) {
    return json({ error: 'forbidden' }, 403);
  }

  const endpoint = (Deno.env.get('R2_ENDPOINT') ?? '').replace(/\/$/, '');
  const r2 = new AwsClient({
    accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!,
    secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!,
    service: 's3',
    region: Deno.env.get('R2_REGION') ?? 'auto',
  });

  const res = await r2.fetch(`${endpoint}/${Deno.env.get('R2_BUCKET')}/${key}`, {
    method: 'DELETE',
  });
  // S3 の DELETE は存在しないキーでも 204 を返す(冪等)。
  if (!res.ok && res.status !== 404) {
    return json({ error: `delete failed: ${res.status}` }, 502);
  }

  return json({ ok: true });
});
