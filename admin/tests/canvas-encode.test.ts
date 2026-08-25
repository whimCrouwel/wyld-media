// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { encodeCanvas } from '../src/lib/canvas-encode';

// jsdom の canvas は toBlob を実装していないので、ブラウザ差分をフェイクで再現する。
// Chrome 系: 要求どおりの MIME でエンコードする。
// Safari 系: image/webp 非対応 → 黙って PNG を返し quality も無視する(実機で確認済みの挙動)。

function fakeCanvas(
  toBlob: (cb: (b: Blob | null) => void, type?: string, quality?: number) => void,
): HTMLCanvasElement {
  return { width: 1600, height: 1067, toBlob } as unknown as HTMLCanvasElement;
}

describe('encodeCanvas', () => {
  it('WebP がエンコードできるブラウザではそのまま WebP を返す', async () => {
    const canvas = fakeCanvas((cb, type) => {
      cb(new Blob([new Uint8Array(100)], { type }));
    });
    const blob = await encodeCanvas(canvas, 0.85, 1);
    expect(blob?.type).toBe('image/webp');
  });

  it('WebP 非対応(Safari)で PNG が返ってきたら JPEG で再エンコードする', async () => {
    const calls: Array<{ type?: string; quality?: number }> = [];
    const canvas = fakeCanvas((cb, type, quality) => {
      calls.push({ type, quality });
      // Safari: webp 要求は PNG になり quality は無視される
      const actual = type === 'image/webp' ? 'image/png' : type;
      cb(new Blob([new Uint8Array(100)], { type: actual }));
    });
    const blob = await encodeCanvas(canvas, 0.7, 1);
    expect(blob?.type).toBe('image/jpeg');
    // JPEG の再エンコードにも quality が渡ること(これが効かないと縮小しか手がなくなる)
    expect(calls).toEqual([
      { type: 'image/webp', quality: 0.7 },
      { type: 'image/jpeg', quality: 0.7 },
    ]);
  });

  it('toBlob が null を返したら null のまま伝播する(encodeUnderLimit が次の試行へ進む)', async () => {
    const canvas = fakeCanvas((cb) => cb(null));
    const blob = await encodeCanvas(canvas, 0.85, 1);
    expect(blob).toBeNull();
  });
});
