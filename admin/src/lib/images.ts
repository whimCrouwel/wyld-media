// カバー画像のクライアント側処理(純粋ロジック部分)。
// Canvas 依存のエンコード処理はコールバックで注入する(cover-widget.ts 側が持つ)。

import type { SupabaseClient } from '@supabase/supabase-js';

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

// 本文画像の上限。supabase の enforce_body_image_rules の max_images と一致させること。
// 権威は DB 側。ここでの判定は UX(ボタンを止める)目的でしかない。
export const MAX_BODY_IMAGES = 5;

// カバー画像・本文画像の両方で使う。
export async function uploadImage(
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

// markdown の画像記法 ![alt](url) の数。DB 側の regexp と同じ形。
// リンク記法 [text](url) は先頭の ! がないので数えない。
export function countBodyImages(markdown: string): number {
  return (markdown.match(/!\[[^\]]*\]\(\s*[^)\s]+/g) ?? []).length;
}

export function insertAtCursor(textarea: HTMLTextAreaElement, text: string): void {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
  const caret = start + text.length;
  textarea.selectionStart = caret;
  textarea.selectionEnd = caret;
}

// 許可ホスト。settings は authenticated なら誰でも select できる(RLS)。
export async function fetchImageBaseUrl(supabase: SupabaseClient): Promise<string> {
  const { data, error } = await supabase
    .from('settings')
    .select('image_base_url')
    .eq('id', 1)
    .single();
  if (error) throw error;
  return (data as { image_base_url: string }).image_base_url;
}
