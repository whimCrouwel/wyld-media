import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { listMyMedia, recordMedia, deleteMedia, translateMediaError } from '../src/lib/media';
import type { MediaItem } from '../src/lib/media';

const supabase = createClient(
  process.env.PUBLIC_SUPABASE_URL!,
  process.env.PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } },
);

let uid = '';
let base = '';
const created: string[] = [];

beforeAll(async () => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: 'hana@seed.local',
    password: 'seed-pass-1234',
  });
  if (error) throw error;
  uid = data.user!.id;

  // settings は読むだけ(他のテストファイルが並列で依存している)
  const { data: s, error: se } = await supabase
    .from('settings').select('image_base_url').eq('id', 1).single();
  if (se) throw se;
  base = (s as { image_base_url: string }).image_base_url;
  expect(base).not.toBe('');
});

afterEach(async () => {
  for (const url of created.splice(0)) {
    await supabase.from('media').delete().eq('url', url);
  }
});

describe('recordMedia / listMyMedia', () => {
  it('記録した画像が一覧に出る', async () => {
    const url = `${base}/${uid}/rec-${crypto.randomUUID()}.webp`;
    created.push(url);
    const item = await recordMedia(supabase, url, 4321);

    expect(item.url).toBe(url);
    expect(item.bytes).toBe(4321);

    const list = await listMyMedia(supabase);
    expect(list.map((m) => m.url)).toContain(url);
  });

  it('許可ホスト外の URL は拒否される', async () => {
    await expect(
      recordMedia(supabase, `https://evil.example/${uid}/x.webp`, 1),
    ).rejects.toThrow(/IMAGE_HOST_NOT_ALLOWED/);
  });

  it('他人の uid 配下のキーは拒否される', async () => {
    const other = '00000000-0000-0000-0000-000000000000';
    await expect(
      recordMedia(supabase, `${base}/${other}/x.webp`, 1),
    ).rejects.toThrow(/MEDIA_OWNER_MISMATCH/);
  });
});

describe('translateMediaError', () => {
  it('MEDIA_IN_USE を訳す', () => {
    expect(translateMediaError(new Error('MEDIA_IN_USE'))).toContain('使われて');
  });

  it('IMAGE_HOST_NOT_ALLOWED を訳す', () => {
    expect(translateMediaError(new Error('IMAGE_HOST_NOT_ALLOWED'))).toContain('許可されていない');
  });

  it('MEDIA_DELETE_DENIED を訳す', () => {
    expect(translateMediaError(new Error('MEDIA_DELETE_DENIED'))).toContain('自分がアップロード');
  });

  it('未知のエラーは汎用文言に落とす', () => {
    expect(translateMediaError(new Error('boom'))).toContain('失敗');
  });

  it('実際の PostgrestError の形(Error を継承しないプレーンオブジェクト)でも訳す', () => {
    const postgrestError = { message: 'MEDIA_IN_USE', code: 'P0001', details: null, hint: null };
    expect(translateMediaError(postgrestError)).toContain('使われて');
  });
});

// deleteMedia の呼び出し順序と、DB 行削除後の R2 削除失敗の扱いを検証する
// モックテスト。実 DB には触れない。
describe('deleteMedia (mocked)', () => {
  const item: MediaItem = {
    id: 'media-1',
    url: 'https://pub-example.r2.dev/uid-1/photo.webp',
    bytes: 1234,
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  // 実コードの呼び出し連鎖 (from().delete({count:'exact'}).eq()、
  // functions.invoke()) の形だけを模した fake クライアント。
  // order には呼ばれたメソッドを呼ばれた順に積む。
  const makeFakeSupabase = (
    deleteResult: { error: unknown; count: number | null },
    invokeResult: { error: unknown },
    order: string[],
  ) => ({
    from: (_table: string) => ({
      delete: (_opts: { count: 'exact' }) => ({
        eq: (_col: string, _val: string) => {
          order.push('delete');
          return Promise.resolve(deleteResult);
        },
      }),
    }),
    functions: {
      invoke: (_name: string, _opts: { body: { url: string } }) => {
        order.push('invoke');
        return Promise.resolve(invokeResult);
      },
    },
  }) as unknown as SupabaseClient;

  it('成功時: 行削除の後に R2 削除を呼び、例外を投げない', async () => {
    const order: string[] = [];
    const supabase = makeFakeSupabase({ error: null, count: 1 }, { error: null }, order);

    await expect(deleteMedia(supabase, item)).resolves.toBeUndefined();
    expect(order).toEqual(['delete', 'invoke']);
  });

  it('使用中: MEDIA_IN_USE で行削除が失敗したら投げ、R2 削除は呼ばない', async () => {
    const order: string[] = [];
    const supabase = makeFakeSupabase(
      { error: new Error('MEDIA_IN_USE'), count: null },
      { error: null },
      order,
    );

    await expect(deleteMedia(supabase, item)).rejects.toThrow(/MEDIA_IN_USE/);
    expect(order).toEqual(['delete']);
  });

  it('count===0: MEDIA_DELETE_DENIED を投げ、R2 削除は呼ばない', async () => {
    const order: string[] = [];
    const supabase = makeFakeSupabase({ error: null, count: 0 }, { error: null }, order);

    await expect(deleteMedia(supabase, item)).rejects.toThrow(/MEDIA_DELETE_DENIED/);
    expect(order).toEqual(['delete']);
  });

  it('行削除は成功したが R2 削除が失敗: 例外を投げず、console.error で記録する', async () => {
    const order: string[] = [];
    const supabase = makeFakeSupabase(
      { error: null, count: 1 },
      { error: { message: 'boom' } },
      order,
    );
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(deleteMedia(supabase, item)).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });
});
