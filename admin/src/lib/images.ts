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
