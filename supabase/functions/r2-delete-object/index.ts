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

  if (typeof payload.url !== 'string') {
    return json({ error: 'url must be a string' }, 400);
  }

  // 公開URLのベースは DB の settings.image_base_url を唯一の権威とする
  // (r2-upload-url が publicUrl を組み立てるのと同じ値。env に別途
  // R2_PUBLIC_BASE_URL を持たせるとズレる余地が生まれるので持たない)。
  const { data: settingsRow } = await admin
    .from('settings')
    .select('image_base_url')
    .eq('id', 1)
    .single();
  const publicBase = (settingsRow?.image_base_url ?? '').replace(/\/$/, '');
  const url = payload.url;
  if (!publicBase || !url.startsWith(`${publicBase}/`)) {
    return json({ error: 'url must live under settings.image_base_url' }, 400);
  }

  const key = url.slice(publicBase.length + 1);
  // 削除対象キーは r2-upload-url が発行する形 `${uid}/${uuid}.${ext}` のみ許可する。
  // prefix 一致だけだと `${uid}/../${victim}/x.webp` が通り、URL 正規化後に
  // 他人(あるいは別バケット)のオブジェクトを消せてしまう(パストラバーサル)。
  const KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg|png)$/;
  if (!KEY_RE.test(key) || !key.startsWith(`${userData.user.id}/`)) {
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
