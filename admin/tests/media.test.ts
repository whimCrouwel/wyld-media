import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { listMyMedia, recordMedia, deleteMedia, translateMediaError } from '../src/lib/media';

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

  it('未知のエラーは汎用文言に落とす', () => {
    expect(translateMediaError(new Error('boom'))).toContain('失敗');
  });
});
