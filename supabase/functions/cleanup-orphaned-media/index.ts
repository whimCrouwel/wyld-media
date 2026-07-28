// 未使用メディアの自動掃除。pg_cron(migration 20260728150000)が週1で起動する。
//
//   1. RPC delete_orphaned_media() が「どこからも参照されておらず7日以上経過した」
//      media 行を原子的に削除し、URL と R2 キーを返す(検出・キー導出とも DB 側に一元化)
//   2. 返ったキーの R2 オブジェクトをここで削除する
//
// 順序は DB 行 → R2 オブジェクト(admin/src/lib/media.ts と同じ「DB が正」の
// 方針。逆順だと R2 削除後に DB 削除が失敗したとき、404 を指す死んだ media 行が
// 残ってメディアライブラリに出続ける)。R2 側の削除に失敗した URL は media 行が
// もう無く次回実行では検知できないため、レスポンスとログに明示する(手動対応)。
import { createClient } from 'npm:@supabase/supabase-js@2';
import { AwsClient } from 'npm:aws4fetch';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// r2-delete-object と同じキー形式ガード(`${uid}/${uuid}.${ext}`)。キーは自前の
// DB 関数から来るとはいえ、想定外のキーへ DELETE を撃たないための保険。
// file ブロック用に pdf も許可する(r2-upload-url の ALLOWED_TYPES と同じ集合)。
const KEY_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg|png|pdf)$/;

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405);
  }

  // 呼び出せるのは service role key を持つ相手(= pg_cron 経由の自環境)だけ。
  // 通常ユーザーの JWT では拒否する。
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  if (req.headers.get('Authorization') !== `Bearer ${serviceRoleKey}`) {
    return json({ error: 'forbidden' }, 403);
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceRoleKey);

  const { data: orphans, error: rpcError } = await admin.rpc('delete_orphaned_media');
  if (rpcError) {
    console.error('delete_orphaned_media failed:', rpcError.message);
    return json({ error: rpcError.message }, 500);
  }
  if (!orphans || orphans.length === 0) {
    console.log('cleanup-orphaned-media: no orphans');
    return json({ deleted: 0, failed: [] });
  }

  const endpoint = (Deno.env.get('R2_ENDPOINT') ?? '').replace(/\/$/, '');
  const r2 = new AwsClient({
    accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!,
    secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!,
    service: 's3',
    region: Deno.env.get('R2_REGION') ?? 'auto',
  });
  const bucket = Deno.env.get('R2_BUCKET')!;

  const failed: string[] = [];
  for (const { url, key } of orphans as { url: string; key: string }[]) {
    if (!KEY_RE.test(key)) {
      failed.push(url);
      continue;
    }
    // S3 の DELETE は存在しないキーでも 204 を返す(冪等)。
    const res = await r2.fetch(`${endpoint}/${bucket}/${key}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) {
      failed.push(url);
    }
  }

  if (failed.length > 0) {
    console.error('R2 delete failed for (media rows already gone, delete manually):', failed);
  }
  console.log(`cleanup-orphaned-media: deleted ${orphans.length} media rows, ${failed.length} R2 failures`);
  return json({ deleted: orphans.length, failed });
});
