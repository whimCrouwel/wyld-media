// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  MAX_UPLOAD_BYTES, MAX_EDGE, ENCODE_ATTEMPTS,
  scaledSize, encodeUnderLimit, translateUploadError,
  MAX_BODY_IMAGES, fetchImageBaseUrl,
} from '../src/lib/images';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('constants', () => {
  it('サーバー側の上限をミラーする', () => {
    expect(MAX_UPLOAD_BYTES).toBe(512_000); // r2-upload-url の MAX_BYTES と同値
    expect(MAX_EDGE).toBe(1600);
  });

  it('DB 側の上限と同じ 5 を公開している', () => {
    expect(MAX_BODY_IMAGES).toBe(5);
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

describe('fetchImageBaseUrl', () => {
  it('settings.image_base_url を返す', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({ data: { image_base_url: 'https://img.test' }, error: null }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;
    expect(await fetchImageBaseUrl(supabase)).toBe('https://img.test');
  });

  it('エラーなら throw する', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({ single: async () => ({ data: null, error: new Error('denied') }) }),
        }),
      }),
    } as unknown as SupabaseClient;
    await expect(fetchImageBaseUrl(supabase)).rejects.toThrow('denied');
  });
});
