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
  if (userId === callerData.user.id) {
    return json({ error: 'cannot delete yourself' }, 400);
  }

  // 記事を持つユーザーは articles_author_id_fkey(restrict)で本来ブロックされるが、
  // GoTrue はその DB エラーを 500 の AuthRetryableFetchError に丸めてしまい
  // メッセージが失われる。わかりやすいエラーを返すため先に件数チェックする
  // (実際の強制力は引き続き DB 側の制約が担保する)。
  const { count, error: countError } = await admin
    .from('articles')
    .select('id', { count: 'exact', head: true })
    .eq('author_id', userId);
  if (countError) return json({ error: countError.message }, 500);
  if ((count ?? 0) > 0) return json({ error: 'user has articles' }, 400);

  // commission_tokens.provider_id / writer_id も profiles への FK(on delete 指定なし = restrict)。
  // 依頼のやり取り履歴があるユーザーは同様に削除前に検出してわかりやすいエラーを返す。
  const { count: tokenCount, error: tokenCountError } = await admin
    .from('commission_tokens')
    .select('id', { count: 'exact', head: true })
    .or(`provider_id.eq.${userId},writer_id.eq.${userId}`);
  if (tokenCountError) return json({ error: tokenCountError.message }, 500);
  if ((tokenCount ?? 0) > 0) return json({ error: 'user has commission tokens' }, 400);

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    return json({ error: 'failed to delete user' }, 400);
  }

  return json({ ok: true });
});
