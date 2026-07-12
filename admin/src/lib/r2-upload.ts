import type { SupabaseClient } from '@supabase/supabase-js';

export interface UploadTicket {
  uploadUrl: string;
  publicUrl: string;
  headers: Record<string, string>;
}

export async function requestUploadUrl(
  supabase: SupabaseClient, file: File, kind: 'image' | 'file',
): Promise<UploadTicket> {
  const { data, error } = await supabase.functions.invoke('r2-upload-url', {
    body: { contentType: file.type, contentLength: file.size, kind },
  });
  if (error) throw error;
  return data as UploadTicket;
}

// 画像・ファイルの両方で使う低レベルのアップロード原始関数。
// 上限バイト数のUX的なチェック(images.ts の MAX_UPLOAD_BYTES)や、
// ノード種別ごとの挿入処理は呼び出し元(block-uploads.ts)の責務。
export async function uploadToR2(
  supabase: SupabaseClient, file: File, kind: 'image' | 'file', fetchFn: typeof fetch = fetch,
): Promise<{ url: string }> {
  const ticket = await requestUploadUrl(supabase, file, kind);
  const res = await fetchFn(ticket.uploadUrl, {
    method: 'PUT',
    headers: ticket.headers,
    body: file,
  });
  if (!res.ok) throw new Error(`UPLOAD_FAILED: ${res.status}`);
  return { url: ticket.publicUrl };
}
