import type { SupabaseClient } from '@supabase/supabase-js';
import type { Editor } from '@tiptap/core';
import { uploadToR2 } from './r2-upload';
import { uploadEncodedAndRecord } from './body-image';

// アップロードに失敗した場合の例外は握りつぶさずそのまま伝播させる。
// 呼び出し元(edit.astro/new.astro)が images.ts の translateUploadError で
// 日本語に翻訳する。
// blob はトリミングダイアログ(crop-dialog)で切り抜き・512KB以内に
// エンコード済みのもの。ここでは再圧縮せずそのままアップロードする。
export async function insertImageBlobBlock(
  supabase: SupabaseClient, editor: Editor, blob: Blob,
): Promise<void> {
  const url = await uploadEncodedAndRecord(supabase, blob);
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
