import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import {
  fetchMyRole, fetchMyProfile, fetchAllProfiles, updateUserRole,
  validateInviteInput, inviteUser, translateInviteError,
  fetchSettings, updateSettings,
} from '../src/lib/admin';
import type { SupabaseClient } from '@supabase/supabase-js';

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

describe('fetchMyProfile', () => {
  it('avatar_url が設定済みのユーザーは name と avatarUrl を返す', async () => {
    expect(await fetchMyProfile(hanaClient)).toEqual({
      name: '田中 花',
      avatarUrl: 'https://picsum.photos/seed/tanaka-hana/400/400',
    });
  });

  it('avatar_url が未設定のユーザーは avatarUrl: null を返す', async () => {
    expect(await fetchMyProfile(adminClient)).toEqual({
      name: '運営 太郎',
      avatarUrl: null,
    });
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
  });

  it('非 admin(writer)は自分の行と、他の writer の行までしか見えない', async () => {
    // Task 1 で追加された「authenticated は writer プロフィールを読める」ポリシーにより、
    // provider が依頼トークンの宛先ライターを選べる。writer 自身から見ても同じ範囲になる。
    const mine = await fetchAllProfiles(hanaClient);
    const slugs = mine.map((p) => p.slug);
    expect(slugs).toContain('tanaka-hana');
    expect(slugs).toContain('sato-kenta');
    expect(slugs).not.toContain('seed-admin');
    expect(slugs).not.toContain('forest-org');
  });
});

describe('updateUserRole', () => {
  it('admin が writer を provider に上げると role が更新される', async () => {
    try {
      await updateUserRole(adminClient, kentaId, 'provider');
      const { data } = await adminClient
        .from('profiles').select('role').eq('id', kentaId).single();
      expect(data!.role).toBe('provider');
    } finally {
      // 後始末: role をシード状態へ戻す(admin はトリガーを通過できる)
      await adminClient.from('profiles').update({ role: 'writer' }).eq('id', kentaId);
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

describe('validateInviteInput', () => {
  const ok = { email: 'x@example.com', name: '山田', slug: 'yamada', role: 'writer' as const };
  it('正しい入力は null', () => {
    expect(validateInviteInput(ok)).toBeNull();
  });
  it('不正なメール・空の名前・不正な slug を弾く', () => {
    expect(validateInviteInput({ ...ok, email: 'ダメ' })).toContain('メールアドレス');
    expect(validateInviteInput({ ...ok, name: '  ' })).toContain('名前');
    expect(validateInviteInput({ ...ok, slug: 'Bad_Slug' })).toContain('スラッグ');
  });
});

describe('inviteUser', () => {
  function stubInvoke(result: { error: unknown }) {
    const calls: unknown[] = [];
    const supabase = {
      functions: {
        invoke: async (name: string, opts: unknown) => {
          calls.push([name, opts]);
          return result;
        },
      },
    } as unknown as SupabaseClient;
    return { supabase, calls };
  }
  const input = { email: 'x@example.com', name: '山田', slug: 'yamada', role: 'writer' as const };

  it('invite-user にペイロードを送る', async () => {
    const { supabase, calls } = stubInvoke({ error: null });
    await inviteUser(supabase, input);
    expect(calls[0]).toEqual(['invite-user', { body: input }]);
  });

  it('EF のエラー本文を掘り出して throw する', async () => {
    const err = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
    });
    const { supabase } = stubInvoke({ error: err });
    await expect(inviteUser(supabase, input)).rejects.toThrow('forbidden');
  });

  it('本文が JSON でなければ元のメッセージで throw する', async () => {
    const err = Object.assign(new Error('non-2xx'), {
      context: new Response('oops', { status: 500 }),
    });
    const { supabase } = stubInvoke({ error: err });
    await expect(inviteUser(supabase, input)).rejects.toThrow('non-2xx');
  });
});

describe('translateInviteError', () => {
  it('既知のエラーを日本語にする', () => {
    expect(translateInviteError(new Error('A user with this email address has already been registered')))
      .toContain('既に登録');
    expect(translateInviteError(new Error('duplicate key value violates unique constraint "profiles_slug_key"')))
      .toContain('スラッグ');
    expect(translateInviteError(new Error('forbidden'))).toContain('管理者のみ');
    expect(translateInviteError(new Error('email, name, slug, and role (writer|provider) are required')))
      .toContain('入力内容');
  });
  it('未知は汎用メッセージ', () => {
    expect(translateInviteError(new Error('boom'))).toContain('招待に失敗');
  });
});

describe('settings', () => {
  it('authenticated なら誰でも読める', async () => {
    const s = await fetchSettings(hanaClient);
    expect(s.postIntervalDays).toBeGreaterThanOrEqual(0);
    expect(s.featuredCount).toBeGreaterThanOrEqual(0);
    expect(s.pageSize).toBeGreaterThanOrEqual(1);
  });

  it('非 admin の更新は RLS で 0 行 → SETTINGS_UPDATE_DENIED', async () => {
    const current = await fetchSettings(hanaClient);
    await expect(updateSettings(hanaClient, current)).rejects.toThrow('SETTINGS_UPDATE_DENIED');
  });

  it('admin は featured_count を更新できる(post_interval_days・page_size は現値のまま)', async () => {
    // ⚠️ post_interval_days は並列実行中の articles.test.ts(頻度制限)が読むため変更しない。
    // featured_count はどのトリガーからも読まれないので安全に動かせる。
    const before = await fetchSettings(adminClient);
    try {
      await updateSettings(adminClient, { ...before, featuredCount: before.featuredCount + 1 });
      const after = await fetchSettings(adminClient);
      expect(after.featuredCount).toBe(before.featuredCount + 1);
      expect(after.postIntervalDays).toBe(before.postIntervalDays);
      expect(after.pageSize).toBe(before.pageSize);
    } finally {
      await updateSettings(adminClient, before);
    }
  });

  it('不正な値は送信前に弾く', async () => {
    await expect(updateSettings(adminClient, { postIntervalDays: -1, featuredCount: 3, pageSize: 2 }))
      .rejects.toThrow('INVALID_SETTINGS');
    await expect(updateSettings(adminClient, { postIntervalDays: 10, featuredCount: 1.5, pageSize: 2 }))
      .rejects.toThrow('INVALID_SETTINGS');
  });

  it('pageSize が 1 未満なら INVALID_SETTINGS', async () => {
    const current = await fetchSettings(adminClient);
    await expect(
      updateSettings(adminClient, { ...current, pageSize: 0 }),
    ).rejects.toThrow('INVALID_SETTINGS');
  });

  it('pageSize が整数でなければ INVALID_SETTINGS', async () => {
    const current = await fetchSettings(adminClient);
    await expect(
      updateSettings(adminClient, { ...current, pageSize: 1.5 }),
    ).rejects.toThrow('INVALID_SETTINGS');
  });
});
