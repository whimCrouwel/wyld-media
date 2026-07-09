import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { fetchMyRole, fetchAllProfiles, updateUserRole } from '../src/lib/admin';

const url = process.env.PUBLIC_SUPABASE_URL!;
const anon = process.env.PUBLIC_SUPABASE_ANON_KEY!;

const adminClient = createClient(url, anon, { auth: { persistSession: false } });
const hanaClient = createClient(url, anon, { auth: { persistSession: false } });

let hanaId: string;
let kentaId: string;

beforeAll(async () => {
  const a = await adminClient.auth.signInWithPassword({
    email: 'admin@seed.local', password: 'seed-pass-1234',
  });
  if (a.error) throw a.error;
  const h = await hanaClient.auth.signInWithPassword({
    email: 'hana@seed.local', password: 'seed-pass-1234',
  });
  if (h.error) throw h.error;
  hanaId = h.data.user!.id;

  const { data, error } = await adminClient
    .from('profiles').select('id').eq('slug', 'sato-kenta').single();
  if (error) throw error;
  kentaId = data.id;
});

describe('fetchMyRole', () => {
  it('admin は admin、writer は writer を返す', async () => {
    expect(await fetchMyRole(adminClient)).toBe('admin');
    expect(await fetchMyRole(hanaClient)).toBe('writer');
  });
});

describe('fetchAllProfiles', () => {
  it('admin は全ユーザーを見られる', async () => {
    const all = await fetchAllProfiles(adminClient);
    expect(all.length).toBeGreaterThanOrEqual(4);
    const slugs = all.map((p) => p.slug);
    for (const s of ['seed-admin', 'tanaka-hana', 'sato-kenta', 'forest-org']) {
      expect(slugs).toContain(s);
    }
    const forest = all.find((p) => p.slug === 'forest-org')!;
    expect(forest.commissionCode).toMatch(/^WM-[0-9A-F]{8}$/);
  });

  it('非 admin は RLS により自分の行しか見えない', async () => {
    const mine = await fetchAllProfiles(hanaClient);
    expect(mine.map((p) => p.slug)).toEqual(['tanaka-hana']);
  });
});

describe('updateUserRole', () => {
  it('admin が writer を provider に上げると依頼者コードが自動発行される', async () => {
    try {
      await updateUserRole(adminClient, kentaId, 'provider');
      const { data } = await adminClient
        .from('profiles').select('role, commission_code').eq('id', kentaId).single();
      expect(data!.role).toBe('provider');
      expect(data!.commission_code).toMatch(/^WM-[0-9A-F]{8}$/);
    } finally {
      // 後始末: role と commission_code をシード状態へ戻す(admin はトリガーを通過できる)
      await adminClient.from('profiles')
        .update({ role: 'writer', commission_code: null }).eq('id', kentaId);
    }
  });

  it('非 admin は自分の role を変えられない(トリガーで拒否)', async () => {
    await expect(updateUserRole(hanaClient, hanaId, 'provider'))
      .rejects.toThrow(/admin/);
  });

  it('非 admin は他人の行に触れない(RLS で 0 行 → ROLE_UPDATE_DENIED)', async () => {
    await expect(updateUserRole(hanaClient, kentaId, 'provider'))
      .rejects.toThrow('ROLE_UPDATE_DENIED');
  });

  it('writer/provider 以外の role は受け付けない', async () => {
    await expect(
      updateUserRole(adminClient, kentaId, 'admin' as unknown as 'writer'),
    ).rejects.toThrow('INVALID_ROLE');
  });
});
