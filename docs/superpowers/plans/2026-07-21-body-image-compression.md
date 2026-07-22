# Body Image Compression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make in-article body-image uploads compress/resize large photos client-side before uploading, the same way the cover-image widget already does, so large photos no longer fail with a confusing error.

**Architecture:** No new code is needed. `admin/src/lib/body-image.ts` already exports `uploadAndRecord()` — a fully working resize (canvas, long edge ≤1600px) → progressive re-encode-under-512KB (`encodeUnderLimit`) → R2 upload → media-library record pipeline. It's currently dead code (never called). `insertImageBlock()` in `admin/src/lib/block-uploads.ts` instead uploads the raw, unmodified `File` via `uploadToR2()`, which sends `file.size` straight to the edge function. The fix is to wire the existing pipeline in.

**Tech Stack:** Astro admin CMS, TypeScript, Vitest (`environment: 'node'`, no DOM — this codebase mocks browser-dependent modules rather than polyfilling DOM).

## Global Constraints

- Do not touch the 512,000-byte limit itself (`admin/src/lib/images.ts:6` `MAX_UPLOAD_BYTES`, mirrored server-side in `supabase/functions/r2-upload-url/index.ts:5` `MAX_BYTES`) — it's intentionally kept in sync between client and edge function; this plan works within it, not around it.
- No new npm dependency — the existing hand-rolled Canvas `toBlob` pipeline is reused as-is.
- Scope is images only (`insertImageBlock`). File attachments (`insertFileBlock`, PDFs) are unaffected — PDFs can't be client-side resized, and the user's report was specifically about photos.

---

## Root Cause (for context)

- Cover/profile images (`admin/src/lib/image-upload-widget.ts:121-123`) already call `encodeUnderLimit()` before upload, so they degrade gracefully under the 512KB cap.
- Body images inserted via the editor's "画像を挿入" slash command go through `insertImageBlock()` (`admin/src/lib/block-uploads.ts:8-16`) → `uploadToR2()` (`admin/src/lib/r2-upload.ts:22-33`), which PUTs the **original, unresized** `File`. A phone photo easily exceeds 512,000 bytes, so `supabase/functions/r2-upload-url/index.ts:75-81` rejects it with HTTP 400 before issuing an upload URL.
- Because that error surfaces as a `FunctionsHttpError` (message is always the generic "Edge Function returned a non-2xx status code" — the real reason lives in `.context`, an unread `Response`), `translateUploadError()` (`admin/src/lib/images.ts:45-51`) can't match it against `IMAGE_TOO_LARGE` and falls through to a generic, misleading "画像のアップロードに失敗しました" message.
- Fixing Task 1 below makes the client always self-validate (and shrink) before ever calling the edge function, so this generic-message case becomes unreachable through normal use — no separate fix to `translateUploadError` is needed.

---

### Task 1: Route body-image uploads through the existing compression pipeline

**Files:**
- Modify: `admin/src/lib/block-uploads.ts` (`insertImageBlock`)
- Modify (test): `admin/tests/block-uploads.test.ts`

**Interfaces:**
- Consumes: `uploadAndRecord(supabase: SupabaseClient, file: File): Promise<string>` from `admin/src/lib/body-image.ts` (already exists, unchanged, returns the public URL after resize+compress+upload+media-library record).
- Produces: `insertImageBlock` keeps its existing signature `(supabase, editor, file) => Promise<void>` — no callers outside this file need to change (`admin/src/pages/articles/new.astro:194`, `admin/src/pages/articles/edit.astro:222` keep working unmodified).

- [ ] **Step 1: Update the test to expect the new dependency**

Replace the `r2-upload` mock in `admin/tests/block-uploads.test.ts` with a `body-image` mock for the `insertImageBlock` describe block only (`insertFileBlock` keeps mocking `uploadToR2`, since it's untouched):

```ts
import { describe, it, expect, vi } from 'vitest';
import { insertImageBlock, insertFileBlock, insertImageUrlBlock } from '../src/lib/block-uploads';

vi.mock('../src/lib/body-image', () => ({
  uploadAndRecord: vi.fn(async (_supabase: unknown, file: File) => `https://img.test/image-${file.name}`),
}));

vi.mock('../src/lib/r2-upload', () => ({
  uploadToR2: vi.fn(async (_supabase: unknown, file: File, kind: 'image' | 'file') => ({
    url: `https://img.test/${kind}-${file.name}`,
  })),
}));

function fakeEditor() {
  const run = vi.fn();
  const insertContent = vi.fn(() => ({ run }));
  const focus = vi.fn(() => ({ insertContent }));
  const chain = vi.fn(() => ({ focus }));
  return { chain, insertContent, run } as unknown as import('@tiptap/core').Editor & {
    insertContent: typeof insertContent; run: typeof run;
  };
}

describe('insertImageBlock', () => {
  it('uploads (via compression pipeline) then inserts an image node with the uploaded url', async () => {
    const editor = fakeEditor();
    const file = new File(['x'], 'photo.webp', { type: 'image/webp' });
    await insertImageBlock({} as never, editor, file);
    expect(editor.insertContent).toHaveBeenCalledWith({
      type: 'image', attrs: { url: 'https://img.test/image-photo.webp', caption: null, alt: '' },
    });
    expect(editor.run).toHaveBeenCalled();
  });
});

describe('insertFileBlock', () => {
  it('uploads then inserts a file node with the uploaded url and filename', async () => {
    const editor = fakeEditor();
    const file = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
    await insertFileBlock({} as never, editor, file);
    expect(editor.insertContent).toHaveBeenCalledWith({
      type: 'file', attrs: { url: 'https://img.test/file-doc.pdf', filename: 'doc.pdf' },
    });
  });
});

describe('insertImageUrlBlock', () => {
  it('inserts an image node directly without uploading', () => {
    const editor = fakeEditor();
    insertImageUrlBlock(editor, 'https://img.test/reused.webp');
    expect(editor.insertContent).toHaveBeenCalledWith({
      type: 'image', attrs: { url: 'https://img.test/reused.webp', caption: null, alt: '' },
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd admin && npx vitest run tests/block-uploads.test.ts`
Expected: FAIL on the `insertImageBlock` test — `body-image`'s mocked `uploadAndRecord` is never called (current code still calls `uploadToR2`), so the inserted URL still comes from the `r2-upload` mock, but since both mocks currently produce the same URL shape, the real signal is: add `expect(bodyImage.uploadAndRecord).toHaveBeenCalledWith({}, editor === undefined ? undefined : expect.anything(), file)`-style assertion is unnecessary — simplest correct failing check is to make the two mocks return *different* URLs so the assertion only passes once the real code switches. Use `https://img.test/compressed-photo.webp` from the `body-image` mock and `https://img.test/image-photo.webp` from the (now-unused-for-images) `r2-upload` mock, then assert on `https://img.test/compressed-photo.webp` in Step 1's test. Re-run and confirm it fails with the URL mismatch before Step 3.

- [ ] **Step 3: Implement — swap `uploadToR2` for `uploadAndRecord` in `insertImageBlock`**

Edit `admin/src/lib/block-uploads.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Editor } from '@tiptap/core';
import { uploadToR2 } from './r2-upload';
import { uploadAndRecord } from './body-image';

// アップロードに失敗した場合の例外は握りつぶさずそのまま伝播させる。
// 呼び出し元(edit.astro/new.astro)が images.ts の translateUploadError で
// 日本語に翻訳する。
export async function insertImageBlock(
  supabase: SupabaseClient, editor: Editor, file: File,
): Promise<void> {
  const url = await uploadAndRecord(supabase, file);
  editor.chain().focus().insertContent({
    type: 'image',
    attrs: { url, caption: null, alt: '' },
  }).run();
}

export async function insertFileBlock(
  supabase: SupabaseClient, editor: Editor, file: File,
): Promise<void> {
  const { url } = await uploadToR2(supabase, file, 'file');
  editor.chain().focus().insertContent({
    type: 'file',
    attrs: { url, filename: file.name },
  }).run();
}

// メディアライブラリからの再利用フロー: アップロードせず既知のURLだけを挿入する。
export function insertImageUrlBlock(editor: Editor, url: string): void {
  editor.chain().focus().insertContent({
    type: 'image',
    attrs: { url, caption: null, alt: '' },
  }).run();
}
```

(`insertFileBlock` is unchanged — it still calls `uploadToR2` with `kind: 'file'`, since PDFs can't go through the image-resize pipeline.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd admin && npx vitest run tests/block-uploads.test.ts`
Expected: PASS — `insertImageBlock` now resolves the URL via the mocked `uploadAndRecord`; `insertFileBlock` and `insertImageUrlBlock` are unaffected and still pass.

- [ ] **Step 5: Run the full admin test suite**

Run: `cd admin && npm test`
Expected: All tests pass, including `admin/tests/body-image.test.ts` (`fitWithin`, untouched) and `admin/tests/images.test.ts`/`images-upload.test.ts` (untouched).

- [ ] **Step 6: Commit**

```bash
git add admin/src/lib/block-uploads.ts admin/tests/block-uploads.test.ts
git commit -m "fix(admin): compress body images client-side before upload"
```

---

## Manual/E2E Verification

Automated tests mock `uploadAndRecord`, so they don't exercise the real Canvas resize path (the admin Vitest environment is `node`, no DOM — consistent with how `image-upload-widget.ts` and the rest of `uploadAndRecord` are already untested at the integration level, only `fitWithin` is unit-tested). Verify the real fix in the browser:

1. `supabase start` (if not already running) and `npm run dev:all` from the repo root.
2. Log into the admin CMS at `http://localhost:4322/login` (`hana@seed.local` / `seed-pass-1234`).
3. Open or create an article, use the block editor's "画像を挿入" slash command, and select a large photo (e.g. an unedited phone photo, typically 2–8MB, well over the 512,000-byte / 500KB limit) that previously failed.
4. Confirm: no error is shown, the status text reads "アップロードしました。保存すると反映されます。"-equivalent (check `uploadStatus` text in `new.astro`/`edit.astro`), and the inserted image renders in the editor.
5. Confirm the image now also appears in the media library picker (since `uploadAndRecord` calls `recordMedia`, matching cover-image behavior) — previously body images inserted via this path were *not* recorded to the library, so this is an additional correctness improvement.
6. Try a very large PDF via "ファイルを添付" to confirm `insertFileBlock`'s behavior is unchanged (still subject to the raw 500KB limit, no resize possible for PDFs — this is expected and out of scope here).
