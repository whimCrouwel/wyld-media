import type { SupabaseClient } from '@supabase/supabase-js';
import { MAX_EDGE, encodeUnderLimit, scaledSize, uploadImage } from './images';
import { recordMedia } from './media';

// 長辺を maxEdge 以内に収める。元が小さければ拡大しない。
export function fitWithin(
  width: number, height: number, maxEdge: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  return scaledSize(width, height, maxEdge / longest);
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('IMAGE_LOAD_FAILED'));
    img.src = src;
  });
}

// 縮小 → WebP → 署名付き PUT → media に記録。公開 URL を返す。
// カバー画像ウィジェットからも使う(記録しないとライブラリに出ず、孤児になる)。
export async function uploadAndRecord(
  supabase: SupabaseClient, file: File,
): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('NOT_AN_IMAGE');

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    const blob = await encodeUnderLimit(({ quality, scale }) => {
      const fitted = fitWithin(img.naturalWidth, img.naturalHeight, MAX_EDGE);
      const { width, height } = scaledSize(fitted.width, fitted.height, scale);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
      return new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/webp', quality),
      );
    });

    const url = await uploadImage(supabase, blob);
    await recordMedia(supabase, url, blob.size);
    return url;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
