# 画像パイプライン(計画5)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 記事エディタのカバー画像を「URL手入力」から「ファイル選択 → Cropper.js でクロップ → ブラウザ内でリサイズ・WebP圧縮 → 署名付きURLで R2 へアップロード」に置き換える。

**Architecture:** 画像処理はすべてブラウザ内(Canvas API + Cropper.js)。アップロードは既存 Edge Function `r2-upload-url` が発行する署名付き PUT URL を使う(Content-Type / Content-Length が署名に含まれるため、クライアントは申告と異なるサイズ・タイプでは PUT できない)。ローカル開発では Cloudflare R2 の代わりに Supabase Storage の S3 互換エンドポイントを R2 に見立てて E2E 検証する — そのために Edge Function のエンドポイント URL をハードコードから `R2_ENDPOINT` 環境変数に切り出す。

**Tech Stack:** Cropper.js 1.6.x(spec 指定)、Canvas `toBlob('image/webp')`、既存の aws4fetch 署名(Edge Function 側・変更最小)、Vitest。

## Global Constraints

- 画像は「長辺 1600px・WebP・512,000 バイト以下」に収める(512,000 は `supabase/functions/r2-upload-url/index.ts` の `MAX_BYTES` と同値。クライアント定数はこれをミラーする)
- クロップは Cropper.js(spec: 「選択 → Cropper.js でクロップ → ブラウザ内でリサイズ・WebP圧縮(長辺1600px・500KB目安)→ 署名付きURLで R2 へアップロード」)
- CMS(`admin/`)は anon キーのみを使う。service role キーを持ち込まない
- UI 文言はすべて日本語。デザインなし(骨組みのみ)
- `published_at` はクライアントから送らない(既存不変条件。今回のタスクで articles への書き込みペイロードは変更しない)
- CMS テストは `cd admin && npm test`。ルート `npm test`(公開サイト 11 tests)を壊さない
- DOM を触るウィジェット(cover-widget)は spec のテスト方針どおり手動(ブラウザ)確認。純粋ロジックは Vitest で単体テスト
- コミットは既存流儀: `feat:` / `test:` / `docs:` プレフィックス

## 前提(既存コードの契約)

- Edge Function `r2-upload-url`(認証必須): POST `{ contentType, contentLength }` → `{ uploadUrl, publicUrl, headers }`。許可タイプは `image/webp` / `image/jpeg` / `image/png`、上限 512,000 バイト
- エディタページ(`admin/src/pages/articles/new.astro` / `edit.astro`)は `id="cover"` の input から `collect()` でカバー URL を集める。`buildArticlePayload` が `safeUrl()`(http/https のみ)を通して `cover_image_url` に入れる
- 公開サイトは `cover_image_url` を記事ページでレンダリング済み(`src/pages/articles/[slug].astro:30`)— 公開サイト側の変更は不要
- ローカルのシードユーザー: `hana@seed.local` / `seed-pass-1234`(writer)。anon キーは `supabase status` または `admin/.env` の `PUBLIC_SUPABASE_ANON_KEY`

---

### Task 1: 画像エンコードの純粋ロジック(`images.ts` 前半)

WebP 圧縮の「品質を段階的に落とし、収まらなければ縮小する」戦略を、Canvas に依存しない形で切り出す。エンコード自体はコールバック注入にして Node で完全にテスト可能にする。

**Files:**
- Create: `admin/src/lib/images.ts`
- Test: `admin/tests/images.test.ts`

**Interfaces:**
- Consumes: なし(純粋ロジック)
- Produces(Task 2・4 が使う):
  - `MAX_UPLOAD_BYTES: number`(= 512_000)
  - `MAX_EDGE: number`(= 1600)
  - `interface EncodeAttempt { quality: number; scale: number }`
  - `ENCODE_ATTEMPTS: readonly EncodeAttempt[]`
  - `scaledSize(width: number, height: number, scale: number): { width: number; height: number }`
  - `encodeUnderLimit(encode: (attempt: EncodeAttempt) => Promise<Blob | null>, maxBytes?: number): Promise<Blob>`(全滅なら `Error('IMAGE_TOO_LARGE')` を throw)
  - `translateUploadError(err: unknown): string`(日本語メッセージ)

- [ ] **Step 1: 失敗するテストを書く**

`admin/tests/images.test.ts` を新規作成:

```ts
import { describe, it, expect } from 'vitest';
import {
  MAX_UPLOAD_BYTES, MAX_EDGE, ENCODE_ATTEMPTS,
  scaledSize, encodeUnderLimit, translateUploadError,
} from '../src/lib/images';

describe('constants', () => {
  it('サーバー側の上限をミラーする', () => {
    expect(MAX_UPLOAD_BYTES).toBe(512_000); // r2-upload-url の MAX_BYTES と同値
    expect(MAX_EDGE).toBe(1600);
  });
});

describe('ENCODE_ATTEMPTS', () => {
  it('最初の試行は等倍・高品質', () => {
    expect(ENCODE_ATTEMPTS[0]).toEqual({ quality: 0.85, scale: 1 });
  });
  it('拡大はしない・品質は (0,1) の範囲', () => {
    for (const a of ENCODE_ATTEMPTS) {
      expect(a.scale).toBeGreaterThan(0);
      expect(a.scale).toBeLessThanOrEqual(1);
      expect(a.quality).toBeGreaterThan(0);
      expect(a.quality).toBeLessThan(1);
    }
  });
  it('scale は単調非増加(後の試行ほど小さい画像)', () => {
    for (let i = 1; i < ENCODE_ATTEMPTS.length; i++) {
      expect(ENCODE_ATTEMPTS[i].scale).toBeLessThanOrEqual(ENCODE_ATTEMPTS[i - 1].scale);
    }
  });
});

describe('scaledSize', () => {
  it('縮尺をかけて丸める', () => {
    expect(scaledSize(1600, 1200, 0.75)).toEqual({ width: 1200, height: 900 });
  });
  it('1px 未満にはならない', () => {
    expect(scaledSize(1, 1, 0.1)).toEqual({ width: 1, height: 1 });
  });
});

describe('encodeUnderLimit', () => {
  const blobOf = (bytes: number) => new Blob([new Uint8Array(bytes)], { type: 'image/webp' });

  it('上限に収まった最初の試行の Blob を返す', async () => {
    const sizes = [600_000, 400_000, 100_000];
    let calls = 0;
    const blob = await encodeUnderLimit(async () => blobOf(sizes[calls++]));
    expect(blob.size).toBe(400_000);
    expect(calls).toBe(2); // 3回目は呼ばれない
  });

  it('encode が null を返した試行はスキップする', async () => {
    let calls = 0;
    const blob = await encodeUnderLimit(async () => {
      calls++;
      return calls === 1 ? null : blobOf(1000);
    });
    expect(blob.size).toBe(1000);
  });

  it('全試行が上限超過なら IMAGE_TOO_LARGE を投げる', async () => {
    await expect(encodeUnderLimit(async () => blobOf(MAX_UPLOAD_BYTES + 1)))
      .rejects.toThrow('IMAGE_TOO_LARGE');
  });
});

describe('translateUploadError', () => {
  it('IMAGE_TOO_LARGE を日本語にする', () => {
    expect(translateUploadError(new Error('IMAGE_TOO_LARGE'))).toContain('圧縮できません');
  });
  it('それ以外は汎用メッセージ', () => {
    expect(translateUploadError(new Error('boom'))).toContain('アップロードに失敗');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd admin && npx vitest run tests/images.test.ts`
Expected: FAIL(`Cannot find module '../src/lib/images'` など)

- [ ] **Step 3: 実装を書く**

`admin/src/lib/images.ts` を新規作成:

```ts
// カバー画像のクライアント側処理(純粋ロジック部分)。
// Canvas 依存のエンコード処理はコールバックで注入する(cover-widget.ts 側が持つ)。

export const MAX_UPLOAD_BYTES = 512_000; // supabase/functions/r2-upload-url の MAX_BYTES と一致させる
export const MAX_EDGE = 1600; // 長辺の上限 px

export interface EncodeAttempt {
  quality: number;
  scale: number;
}

// 品質を段階的に落とし、それでも収まらなければ縮小してさらに落とす
export const ENCODE_ATTEMPTS: readonly EncodeAttempt[] = [
  { quality: 0.85, scale: 1 },
  { quality: 0.7, scale: 1 },
  { quality: 0.55, scale: 1 },
  { quality: 0.7, scale: 0.75 },
  { quality: 0.55, scale: 0.75 },
  { quality: 0.55, scale: 0.5 },
  { quality: 0.4, scale: 0.5 },
];

export function scaledSize(
  width: number, height: number, scale: number,
): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function encodeUnderLimit(
  encode: (attempt: EncodeAttempt) => Promise<Blob | null>,
  maxBytes: number = MAX_UPLOAD_BYTES,
): Promise<Blob> {
  for (const attempt of ENCODE_ATTEMPTS) {
    const blob = await encode(attempt);
    if (blob && blob.size <= maxBytes) return blob;
  }
  throw new Error('IMAGE_TOO_LARGE');
}

export function translateUploadError(err: unknown): string {
  const msg = err instanceof Error ? err.message : '';
  if (msg.includes('IMAGE_TOO_LARGE')) {
    return '画像を十分小さく圧縮できませんでした。別の画像をお試しください。';
  }
  return '画像のアップロードに失敗しました。時間をおいて再度お試しください。';
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd admin && npx vitest run tests/images.test.ts`
Expected: PASS(11 tests)

- [ ] **Step 5: コミット**

```bash
git add admin/src/lib/images.ts admin/tests/images.test.ts
git commit -m "feat: image encode ladder for cover uploads (quality/scale fallback)"
```

---

### Task 2: アップロード関数(`images.ts` 後半)

署名付き URL の取得(Edge Function 呼び出し)と R2 への PUT。ネットワークはスタブ注入でテストする(ローカルに実 R2 がないため。E2E は Task 3・5 で検証)。

**Files:**
- Modify: `admin/src/lib/images.ts`(末尾に追記)
- Test: `admin/tests/images-upload.test.ts`

**Interfaces:**
- Consumes: `supabase.functions.invoke`(supabase-js。セッションの JWT を自動で付与する)
- Produces(Task 4 が使う):
  - `interface UploadTicket { uploadUrl: string; publicUrl: string; headers: Record<string, string> }`
  - `requestUploadUrl(supabase: SupabaseClient, blob: Blob): Promise<UploadTicket>`
  - `uploadCover(supabase: SupabaseClient, blob: Blob, fetchFn?: typeof fetch): Promise<string>`(戻り値は publicUrl。PUT 失敗時は `Error('UPLOAD_FAILED: <status>')`)

- [ ] **Step 1: 失敗するテストを書く**

`admin/tests/images-upload.test.ts` を新規作成:

```ts
import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requestUploadUrl, uploadCover } from '../src/lib/images';

const TICKET = {
  uploadUrl: 'https://r2.example/bucket/key?sig=abc',
  publicUrl: 'https://img.example/key',
  headers: { 'Content-Type': 'image/webp' },
};

function stubSupabase(result: { data: unknown; error: unknown }) {
  const calls: unknown[] = [];
  const supabase = {
    functions: {
      invoke: async (name: string, opts: unknown) => {
        calls.push([name, opts]);
        return result;
      },
    },
  } as unknown as SupabaseClient;
  return { supabase, calls };
}

describe('requestUploadUrl', () => {
  it('contentType と contentLength を r2-upload-url に送る', async () => {
    const { supabase, calls } = stubSupabase({ data: TICKET, error: null });
    const blob = new Blob([new Uint8Array(123)], { type: 'image/webp' });
    const ticket = await requestUploadUrl(supabase, blob);
    expect(ticket).toEqual(TICKET);
    expect(calls[0]).toEqual([
      'r2-upload-url',
      { body: { contentType: 'image/webp', contentLength: 123 } },
    ]);
  });

  it('Edge Function がエラーを返したら throw する', async () => {
    const { supabase } = stubSupabase({ data: null, error: new Error('unauthorized') });
    const blob = new Blob([new Uint8Array(1)], { type: 'image/webp' });
    await expect(requestUploadUrl(supabase, blob)).rejects.toThrow('unauthorized');
  });
});

describe('uploadCover', () => {
  const blob = new Blob([new Uint8Array(10)], { type: 'image/webp' });

  it('署名付き URL に PUT して publicUrl を返す', async () => {
    const { supabase } = stubSupabase({ data: TICKET, error: null });
    const puts: unknown[] = [];
    const fetchFn = (async (url: unknown, init: unknown) => {
      puts.push([url, init]);
      return { ok: true, status: 200 } as Response;
    }) as typeof fetch;

    const url = await uploadCover(supabase, blob, fetchFn);

    expect(url).toBe(TICKET.publicUrl);
    const [putUrl, init] = puts[0] as [string, RequestInit];
    expect(putUrl).toBe(TICKET.uploadUrl);
    expect(init.method).toBe('PUT');
    expect(init.headers).toEqual(TICKET.headers);
    expect(init.body).toBe(blob);
  });

  it('PUT が拒否されたら UPLOAD_FAILED を投げる', async () => {
    const { supabase } = stubSupabase({ data: TICKET, error: null });
    const fetchFn = (async () => ({ ok: false, status: 403 } as Response)) as typeof fetch;
    await expect(uploadCover(supabase, blob, fetchFn)).rejects.toThrow('UPLOAD_FAILED: 403');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd admin && npx vitest run tests/images-upload.test.ts`
Expected: FAIL(`requestUploadUrl` が export されていない)

- [ ] **Step 3: 実装を追記**

`admin/src/lib/images.ts` の先頭に import を追加し、末尾に追記:

```ts
// ファイル先頭に追加:
import type { SupabaseClient } from '@supabase/supabase-js';
```

```ts
// ファイル末尾に追加:

export interface UploadTicket {
  uploadUrl: string;
  publicUrl: string;
  headers: Record<string, string>;
}

export async function requestUploadUrl(
  supabase: SupabaseClient, blob: Blob,
): Promise<UploadTicket> {
  const { data, error } = await supabase.functions.invoke('r2-upload-url', {
    body: { contentType: blob.type, contentLength: blob.size },
  });
  if (error) throw error;
  return data as UploadTicket;
}

export async function uploadCover(
  supabase: SupabaseClient, blob: Blob, fetchFn: typeof fetch = fetch,
): Promise<string> {
  const ticket = await requestUploadUrl(supabase, blob);
  const res = await fetchFn(ticket.uploadUrl, {
    method: 'PUT',
    headers: ticket.headers,
    body: blob,
  });
  if (!res.ok) throw new Error(`UPLOAD_FAILED: ${res.status}`);
  return ticket.publicUrl;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd admin && npm test`
Expected: PASS(既存 24 + 新規 15 前後。images.test.ts / images-upload.test.ts を含め全件グリーン)

- [ ] **Step 5: コミット**

```bash
git add admin/src/lib/images.ts admin/tests/images-upload.test.ts
git commit -m "feat: signed-URL request and R2 PUT for cover uploads"
```

---

### Task 3: Edge Function の R2_ENDPOINT 化 + ローカル R2 スタンドイン

現状 `r2-upload-url` は `https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com` をハードコードしており、ローカルで E2E 検証できない。エンドポイントを env に切り出し、ローカルでは Supabase Storage の S3 互換エンドポイント(config.toml で `[storage.s3_protocol] enabled = true` 済み)を R2 に見立てる。

**Files:**
- Modify: `supabase/functions/r2-upload-url/index.ts:59-71`
- Modify: `supabase/config.toml`(`[storage.buckets.covers]` を追加)
- Create: `supabase/functions/.env`(ローカル専用・コミットしない)
- Create: `supabase/functions/.env.example`(コミットする)
- Modify: `docs/superpowers/DEPLOYMENT-CHECKLIST.md`

**Interfaces:**
- Consumes: 既存の `r2-upload-url` リクエスト/レスポンス契約(変更しない)
- Produces: Edge Function の新しい env 契約 — `R2_ENDPOINT`(バケット名の手前までの URL)、`R2_REGION`(省略時 `auto`)、`R2_BUCKET`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`R2_PUBLIC_BASE_URL`。`R2_ACCOUNT_ID` は廃止

- [ ] **Step 1: Edge Function を修正**

`supabase/functions/r2-upload-url/index.ts` の 59〜71 行目(`const key = ...` から `const r2 = new AwsClient({...})` まで)を以下に置き換え:

```ts
  const key = `${userData.user.id}/${crypto.randomUUID()}.${ext}`;
  // R2_ENDPOINT 例:
  //   本番:   https://<account-id>.r2.cloudflarestorage.com
  //   ローカル: http://127.0.0.1:54321/storage/v1/s3(Supabase Storage の S3 互換 API を R2 の代わりに使う)
  // 署名 URL に PUT するのはブラウザなので、ブラウザから到達できるホストであること。
  const objectUrl = new URL(
    `${Deno.env.get('R2_ENDPOINT')}/${Deno.env.get('R2_BUCKET')}/${key}`,
  );
  objectUrl.searchParams.set('X-Amz-Expires', '300');

  const r2 = new AwsClient({
    accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!,
    secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!,
    service: 's3',
    region: Deno.env.get('R2_REGION') ?? 'auto',
  });
```

(署名部分 `r2.sign(...)` と返却 JSON は変更しない。)

- [ ] **Step 2: ローカル用バケットを config.toml に追加**

`supabase/config.toml` のコメントアウトされたバケット例(`# [storage.buckets.images]` 付近、122行目前後)の下に追加:

```toml
# ローカル開発で R2 の代わりに使うバケット(本番は Cloudflare R2)
[storage.buckets.covers]
public = true
```

- [ ] **Step 3: ローカル env ファイルを作成**

`supabase status` を実行し、`S3 Access Key` / `S3 Secret Key` / `anon key` を控える。

`supabase/functions/.env.example` を作成(プレースホルダのみ・コミット対象):

```bash
# r2-upload-url 用。ローカルは Supabase Storage の S3 互換 API を R2 に見立てる。
# 実際の値は `supabase status` の S3 Access Key / S3 Secret Key を転記して
# supabase/functions/.env に保存する(.env はコミットしない)。
R2_ENDPOINT=http://127.0.0.1:54321/storage/v1/s3
R2_REGION=local
R2_BUCKET=covers
R2_ACCESS_KEY_ID=<supabase status の S3 Access Key>
R2_SECRET_ACCESS_KEY=<supabase status の S3 Secret Key>
R2_PUBLIC_BASE_URL=http://127.0.0.1:54321/storage/v1/object/public/covers
# invite-user 用(既存挙動どおり localhost:4322 で良ければ省略可)
# CMS_URL=http://localhost:4322
```

同じ内容で実値を入れた `supabase/functions/.env` を作成。`supabase/.gitignore` が `.env` を無視することを `git status` で確認(`supabase/functions/.env` が untracked に **現れない** こと。現れる場合は `supabase/.gitignore` に `functions/.env` を追記)。

- [ ] **Step 4: スタックを再起動してバケット作成を確認**

```bash
supabase stop && supabase start
supabase functions serve   # 別ターミナルで起動しておく(functions/.env を自動で読む)
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "select id, public from storage.buckets;"
```

Expected: `covers | t` の行がある。無い場合は `supabase seed buckets` を実行して再確認。

- [ ] **Step 5: 署名付き PUT のスモークテスト(curl)**

```bash
ANON=$(grep PUBLIC_SUPABASE_ANON_KEY admin/.env | cut -d= -f2)
TOKEN=$(curl -s "http://127.0.0.1:54321/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d '{"email":"hana@seed.local","password":"seed-pass-1234"}' | jq -r .access_token)
printf 'hello' > /tmp/five.bin   # 5 bytes
RESP=$(curl -s http://127.0.0.1:54321/functions/v1/r2-upload-url \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"contentType":"image/webp","contentLength":5}')
echo "$RESP" | jq .
UPLOAD_URL=$(echo "$RESP" | jq -r .uploadUrl)
PUBLIC_URL=$(echo "$RESP" | jq -r .publicUrl)
curl -s -o /dev/null -w "%{http_code}\n" -X PUT "$UPLOAD_URL" \
  -H "Content-Type: image/webp" --data-binary @/tmp/five.bin
curl -s -o /dev/null -w "%{http_code}\n" "$PUBLIC_URL"
```

Expected: PUT が `200`、公開 URL の GET が `200`。

さらにサイズ不一致の拒否(署名の実効性)を確認:

```bash
printf 'hello!!' > /tmp/seven.bin   # 7 bytes(申告は 5)
curl -s -o /dev/null -w "%{http_code}\n" -X PUT "$UPLOAD_URL" \
  -H "Content-Type: image/webp" --data-binary @/tmp/seven.bin
```

Expected: `403`(SignatureDoesNotMatch)。

**フォールバック:** ローカルの storage-api が presigned query 認証の PUT を拒否する場合(400/403 が正しいリクエストでも返る場合)は、この検証はローカルでは不可能と判断し、BLOCKED として報告すること(勝手に別方式へ改造しない)。その場合ユニットテストと本番 R2 での検証(チェックリスト済み項目)に委ねる判断はコントローラが行う。

- [ ] **Step 6: デプロイチェックリストを更新**

`docs/superpowers/DEPLOYMENT-CHECKLIST.md` の Edge Functions セクションを更新:

- 既存行 `- [ ] R2 実バケット作成 + APIトークン → r2-upload-url の env 設定` を次に置き換え:

```markdown
- [ ] R2 実バケット作成 + APIトークン → `r2-upload-url` の env 設定(`R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`・`R2_REGION=auto`・`R2_BUCKET`・`R2_ACCESS_KEY_ID`・`R2_SECRET_ACCESS_KEY`・`R2_PUBLIC_BASE_URL`。旧 `R2_ACCOUNT_ID` は廃止)
- [ ] R2 バケットに CORS ポリシーを設定(admin サブドメインのオリジンから PUT / Content-Type ヘッダを許可。これが無いとブラウザからのアップロードが CORS で失敗する)
- [ ] `R2_PUBLIC_BASE_URL` は R2 のカスタムドメイン or 公開バケット URL(公開サイト・CMS の両方から画像が見えること)
```

- [ ] **Step 7: コミット**

```bash
git add supabase/functions/r2-upload-url/index.ts supabase/config.toml supabase/functions/.env.example supabase/.gitignore docs/superpowers/DEPLOYMENT-CHECKLIST.md
git commit -m "feat: R2_ENDPOINT env for r2-upload-url + local R2 stand-in via storage S3"
```

(`supabase/.gitignore` は変更が無ければ add 対象から外す。`supabase/functions/.env` は絶対にコミットしない。)

---

### Task 4: カバー画像ウィジェット + エディタ組み込み

`id="cover"` の URL 入力欄を hidden input + クロップ UI に置き換える。両エディタページで共有するため DOM 配線は `cover-widget.ts` に一元化。アップロードはクロップ確定時に即時実行(保存前に abandon すると R2 に孤児画像が残るが MVP では許容 — 将来の掃除タスク)。

**Files:**
- Create: `admin/src/lib/cover-widget.ts`
- Modify: `admin/package.json`(cropperjs 追加)
- Modify: `admin/src/pages/articles/new.astro`
- Modify: `admin/src/pages/articles/edit.astro`

**Interfaces:**
- Consumes: Task 1・2 の `MAX_EDGE` / `encodeUnderLimit` / `scaledSize` / `uploadCover` / `translateUploadError`、既存の `supabaseBrowser`
- Produces: `initCoverWidget(supabase: SupabaseClient): { getUrl(): string; setUrl(url: string | null): void }`(固定 ID の DOM 要素 `cover` / `cover-file` / `cover-crop` / `cover-apply` / `cover-clear` / `cover-status` / `cover-current` を配線する)

- [ ] **Step 1: cropperjs を追加**

```bash
cd admin && npm install cropperjs@^1.6.2
```

Expected: `admin/package.json` の dependencies に `"cropperjs": "^1.6.2"` が入る。

- [ ] **Step 2: ウィジェットを実装**

`admin/src/lib/cover-widget.ts` を新規作成:

```ts
import Cropper from 'cropperjs';
import 'cropperjs/dist/cropper.css';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  MAX_EDGE, encodeUnderLimit, scaledSize, uploadCover, translateUploadError,
} from './images';

export interface CoverWidget {
  getUrl(): string;
  setUrl(url: string | null): void;
}

// 固定 ID の要素(cover / cover-file / cover-crop / cover-apply /
// cover-clear / cover-status / cover-current)を配線する。
export function initCoverWidget(supabase: SupabaseClient): CoverWidget {
  const hidden = document.getElementById('cover') as HTMLInputElement;
  const fileInput = document.getElementById('cover-file') as HTMLInputElement;
  const cropBox = document.getElementById('cover-crop')!;
  const applyBtn = document.getElementById('cover-apply') as HTMLButtonElement;
  const clearBtn = document.getElementById('cover-clear') as HTMLButtonElement;
  const statusEl = document.getElementById('cover-status')!;
  const currentEl = document.getElementById('cover-current')!;

  let cropper: Cropper | null = null;

  const renderCurrent = () => {
    currentEl.innerHTML = '';
    if (hidden.value) {
      const img = document.createElement('img');
      img.src = hidden.value;
      img.alt = '現在のカバー画像';
      img.style.maxWidth = '240px';
      currentEl.appendChild(img);
    } else {
      currentEl.textContent = 'カバー画像は未設定です。';
    }
  };

  const resetCropper = () => {
    cropper?.destroy();
    cropper = null;
    cropBox.innerHTML = '';
    applyBtn.hidden = true;
    fileInput.value = '';
  };

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    cropper?.destroy();
    cropper = null;
    cropBox.innerHTML = '';
    applyBtn.hidden = true;
    if (!file) return;
    const img = document.createElement('img');
    img.src = URL.createObjectURL(file);
    img.style.maxWidth = '100%';
    cropBox.appendChild(img);
    img.addEventListener('load', () => {
      cropper = new Cropper(img, { viewMode: 1, autoCropArea: 1 });
      applyBtn.hidden = false;
    });
  });

  applyBtn.addEventListener('click', async () => {
    if (!cropper) return;
    statusEl.textContent = 'アップロード中…';
    applyBtn.disabled = true;
    try {
      const canvas = cropper.getCroppedCanvas({
        maxWidth: MAX_EDGE,
        maxHeight: MAX_EDGE,
        imageSmoothingQuality: 'high',
      });
      const blob = await encodeUnderLimit(
        (attempt) => encodeCanvas(canvas, attempt.quality, attempt.scale),
      );
      hidden.value = await uploadCover(supabase, blob);
      renderCurrent();
      resetCropper();
      statusEl.textContent = 'アップロードしました。記事を保存すると反映されます。';
    } catch (err) {
      statusEl.textContent = translateUploadError(err);
      console.error(err);
    } finally {
      applyBtn.disabled = false;
    }
  });

  clearBtn.addEventListener('click', () => {
    hidden.value = '';
    renderCurrent();
    resetCropper();
    statusEl.textContent = '';
  });

  renderCurrent();
  return {
    getUrl: () => hidden.value,
    setUrl: (url) => {
      hidden.value = url ?? '';
      renderCurrent();
    },
  };
}

function encodeCanvas(
  source: HTMLCanvasElement, quality: number, scale: number,
): Promise<Blob | null> {
  let canvas = source;
  if (scale < 1) {
    const { width, height } = scaledSize(source.width, source.height, scale);
    const scaled = document.createElement('canvas');
    scaled.width = width;
    scaled.height = height;
    scaled.getContext('2d')!.drawImage(source, 0, 0, width, height);
    canvas = scaled;
  }
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
}
```

- [ ] **Step 3: new.astro を組み替え**

`admin/src/pages/articles/new.astro`:

(a) マークアップ — `<p><label>カバー画像URL(任意) <input type="url" id="cover" /></label></p>` を以下に置き換え:

```html
        <fieldset>
          <legend>カバー画像(任意)</legend>
          <input type="hidden" id="cover" />
          <p id="cover-current"></p>
          <p>
            <input type="file" id="cover-file" accept="image/jpeg,image/png,image/webp" />
            <button type="button" id="cover-clear">画像を外す</button>
          </p>
          <div id="cover-crop" style="max-width:480px;"></div>
          <p>
            <button type="button" id="cover-apply" hidden>切り抜いてアップロード</button>
            <span id="cover-status"></span>
          </p>
        </fieldset>
```

(b) スクリプト — import に追加:

```ts
      import { initCoverWidget } from '../../lib/cover-widget';
```

else ブロック内、`const commissionStatus = ...` の直後に:

```ts
        const cover = initCoverWidget(supabaseBrowser);
```

`collect()` の `coverUrl: $('cover').value,` を `coverUrl: cover.getUrl(),` に変更。

- [ ] **Step 4: edit.astro を組み替え**

`admin/src/pages/articles/edit.astro`:

(a) マークアップ — `<p><label>カバー画像URL(任意) <input type="url" id="cover" /></label></p>` を Step 3(a) と同一の fieldset に置き換え。

(b) スクリプト — import に `initCoverWidget` を追加(Step 3(b) と同じ行)。

`article` が見つかった else ブロック内で、`$('cover').value = article.coverImageUrl ?? '';` を以下に置き換え:

```ts
          const cover = initCoverWidget(supabaseBrowser);
          cover.setUrl(article.coverImageUrl);
```

`collect()` の `coverUrl: $('cover').value,` を `coverUrl: cover.getUrl(),` に変更。

- [ ] **Step 5: ビルドとテストを確認**

```bash
cd admin && npm test && npm run build
```

Expected: 全テスト PASS、7 ページのビルド成功(cropperjs の CSS import で失敗しないこと)。

```bash
npm test   # リポジトリ直下。公開サイト 11 tests に影響なし
```

- [ ] **Step 6: コミット**

```bash
git add admin/package.json admin/package-lock.json admin/src/lib/cover-widget.ts admin/src/pages/articles/new.astro admin/src/pages/articles/edit.astro
git commit -m "feat: cover image crop & upload widget (Cropper.js -> WebP -> R2)"
```

---

### Task 5: E2E 検証 + ドキュメント

ブラウザ実機でフルフロー(選択 → クロップ → アップロード → 保存 → 公開サイト表示)を確認し、README を更新する。ブラウザ操作の検証はコントローラ(Chrome MCP)が行う — このタスクのサブエージェントはテスト画像スクリプトとドキュメントを担当し、ブラウザ確認手順を整えるところまで。

**Files:**
- Create: `scripts/make-test-image.mjs`(検証用のテスト画像生成。依存なし)
- Modify: `README.md`(CMS セクション)

**Interfaces:**
- Consumes: Task 3 のローカル R2 スタンドイン、Task 4 のウィジェット
- Produces: `node scripts/make-test-image.mjs` → カレントに `test-cover.png`(2400×1800、長辺 1600 超でリサイズ経路を通す)

- [ ] **Step 1: テスト画像生成スクリプトを作成**

`scripts/make-test-image.mjs` を新規作成(純 Node、依存なしの PNG エンコーダ):

```js
// 検証用: 2400x1800 のグラデーション PNG を生成する(依存なし)。
// 長辺が 1600 を超えるので、エディタのリサイズ・WebP 圧縮経路を必ず通る。
import { writeFileSync } from 'node:fs';
import zlib from 'node:zlib';

const W = 2400, H = 1800;

const crcTable = [...Array(256)].map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 2;  // color type: RGB

const rows = Buffer.alloc(H * (1 + W * 3)); // 行頭 1 byte はフィルタ(0)
for (let y = 0; y < H; y++) {
  const off = y * (1 + W * 3);
  for (let x = 0; x < W; x++) {
    rows[off + 1 + x * 3] = (x * 255 / W) | 0;
    rows[off + 1 + x * 3 + 1] = (y * 255 / H) | 0;
    rows[off + 1 + x * 3 + 2] = 96;
  }
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(rows)),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync('test-cover.png', png);
console.log(`wrote test-cover.png (${W}x${H}, ${png.length} bytes)`);
```

- [ ] **Step 2: スクリプトを実行して画像を検証**

```bash
node scripts/make-test-image.mjs
file test-cover.png
```

Expected: `PNG image data, 2400 x 1800, 8-bit/color RGB`。`test-cover.png` はリポジトリにコミットしない(検証後に削除)。

- [ ] **Step 3: README を更新**

`README.md` の CMS セクション(「CMS はオリジン分離のため…」の段落の後)に追記:

```markdown
記事エディタのカバー画像は「ファイル選択 → クロップ(Cropper.js)→ ブラウザ内で長辺1600px・WebP圧縮(512KB以下)→ 署名付きURLで R2 へアップロード」。ローカルでは R2 の代わりに Supabase Storage の S3 互換エンドポイントを使う(`supabase/functions/.env.example` 参照)。
```

- [ ] **Step 4: コミット**

```bash
git add scripts/make-test-image.mjs README.md
git commit -m "docs: cover image pipeline + test image generator for verification"
```

- [ ] **Step 5: ブラウザ E2E 検証(コントローラが実施)**

前提: `supabase start`・`supabase functions serve`・`cd admin && npm run dev` が起動済み、DB は seed 済み。

1. `http://localhost:4322/login` で `hana@seed.local` / `seed-pass-1234` ログイン
2. 新しい記事 → タイトル・slug・本文入力
3. `test-cover.png` をファイル選択 → クロップ枠を少し動かす → [切り抜いてアップロード]
4. 「アップロードしました。」表示 + サムネイル表示を確認
5. [公開する] → DB の `cover_image_url` が `R2_PUBLIC_BASE_URL` 配下の URL であること、その URL の GET が 200 で WebP が返ることを確認
6. `npm run build`(リポジトリ直下)→ 公開サイトの記事ページに `<img>` が出ることを確認
7. [画像を外す] → 保存 → `cover_image_url` が NULL に戻ることを確認

---

## 備考(スコープ外・既知の割り切り)

- **孤児画像:** アップロード後に記事を保存しなかった場合、R2 にオブジェクトが残る。MVP では許容(キーは `{userId}/{uuid}.webp` なので後から棚卸し可能)。
- **本文内画像:** 今回はカバー画像のみ。本文マークダウンへの画像挿入と `img` src の R2 ドメイン制限は計画6以降。
- **アスペクト比:** クロップは自由比率(spec に指定なし。固定比率にしたくなったら Cropper の `aspectRatio` オプション 1 行)。
- **ローカル検証の限界:** ローカルの storage-api が presigned PUT を拒否した場合、E2E はデプロイ後の実 R2 検証(チェックリスト)に委ねる。
