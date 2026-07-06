import { createClient } from 'npm:@supabase/supabase-js@2';
import { AwsClient } from 'npm:aws4fetch';
import { corsHeaders } from '../_shared/cors.ts';

const MAX_BYTES = 512_000;
const ALLOWED_TYPES: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

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

  // any authenticated user may upload
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  const { data: userData } = await admin.auth.getUser(jwt);
  if (!userData?.user) return json({ error: 'unauthorized' }, 401);

  let payload: { contentType?: string; contentLength?: number };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  const { contentType, contentLength } = payload;

  const ext = ALLOWED_TYPES[contentType ?? ''];
  if (!ext) {
    return json(
      { error: `contentType must be one of: ${Object.keys(ALLOWED_TYPES).join(', ')}` },
      400,
    );
  }
  if (
    !Number.isInteger(contentLength) ||
    contentLength! <= 0 ||
    contentLength! > MAX_BYTES
  ) {
    return json({ error: `contentLength must be 1..${MAX_BYTES} bytes` }, 400);
  }

  const key = `${userData.user.id}/${crypto.randomUUID()}.${ext}`;
  const objectUrl = new URL(
    `https://${Deno.env.get('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com/` +
      `${Deno.env.get('R2_BUCKET')}/${key}`,
  );
  objectUrl.searchParams.set('X-Amz-Expires', '300');

  const r2 = new AwsClient({
    accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!,
    secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!,
    service: 's3',
    region: 'auto',
  });

  // Content-Length / Content-Type を署名に含める → クライアントは
  // この値と異なるサイズ・タイプでは PUT できない(R2 が拒否する)
  const signed = await r2.sign(
    new Request(objectUrl.toString(), {
      method: 'PUT',
      headers: {
        'Content-Length': String(contentLength),
        'Content-Type': contentType!,
      },
    }),
    { aws: { signQuery: true, allHeaders: true } },
  );

  return json({
    uploadUrl: signed.url,
    publicUrl: `${Deno.env.get('R2_PUBLIC_BASE_URL')}/${key}`,
    headers: { 'Content-Type': contentType },
  });
});
