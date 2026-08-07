import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import {
  fetchMyRole, fetchMyProfile, fetchAllProfiles, updateUserRole,
  updateProviderCertification,
  validateInviteInput, inviteUser, translateInviteError,
  deleteUser, translateDeleteUserError,
  fetchUserAuthStatus, resendInvite, translateResendInviteError,
  fetchSettings, updateSettings,
  fetchAllArticlesForAudit, setModerationHold, updatePublishedAt,
} from '../src/lib/admin';
import { createDraft, deleteArticle } from '../src/lib/articles';
import type { SupabaseClient } from '@supabase/supabase-js';

const url = process.env.PUBLIC_SUPABASE_URL!;
const anon = process.env.PUBLIC_SUPABASE_ANON_KEY!;

const adminClient = createClient(url, anon, { auth: { persistSession: false } });
const hanaClient = createClient(url, anon, { auth: { persistSession: false } });
const certifiedClient = createClient(url, anon, { auth: { persistSession: false } });

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
  const c = await certifiedClient.auth.signInWithPassword({
    email: 'certified@seed.local', password: 'seed-pass-1234',
  });
  if (c.error) throw c.error;

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
      certified: false,
    });
  });

  it('avatar_url が未設定のユーザーは avatarUrl: null を返す', async () => {
    expect(await fetchMyProfile(adminClient)).toEqual({
      name: '運営 太郎',
      avatarUrl: null,
      certified: false,
    });
  });

  it('認定済みプロバイダーは certified: true を返す', async () => {
    const profile = await fetchMyProfile(certifiedClient);
    expect(profile!.certified).toBe(true);
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
    expect(forest.certified).toBe(false);
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

describe('updateProviderCertification', () => {
  let forestId: string;
  beforeAll(async () => {
    const { data, error } = await adminClient
      .from('profiles').select('id').eq('slug', 'forest-org').single();
    if (error) throw error;
    forestId = data.id;
  });

  it('admin が認定フラグを切り替えられる', async () => {
    try {
      await updateProviderCertification(adminClient, forestId, true);
      const { data } = await adminClient
        .from('profiles').select('certified').eq('id', forestId).single();
      expect(data!.certified).toBe(true);
    } finally {
      await adminClient.from('profiles').update({ certified: false }).eq('id', forestId);
    }
  });

  it('非 admin は自分の認定フラグを変えられない(トリガーで拒否)', async () => {
    await expect(updateProviderCertification(hanaClient, hanaId, true))
      .rejects.toThrow(/admin/);
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
  it('provider には certified: true を許可する', () => {
    expect(validateInviteInput({ ...ok, role: 'provider', certified: true })).toBeNull();
  });
  it('writer に certified: true を指定すると弾く', () => {
    expect(validateInviteInput({ ...ok, role: 'writer', certified: true })).toContain('認定');
  });
  it('region は未指定なら OK、12区分なら OK、それ以外は弾く', () => {
    expect(validateInviteInput(ok)).toBeNull();
    expect(validateInviteInput({ ...ok, region: '関東' })).toBeNull();
    expect(validateInviteInput({ ...ok, region: '中部' })).toContain('エリア');
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

  it('certified を含むペイロードもそのまま送る', async () => {
    const { supabase, calls } = stubInvoke({ error: null });
    const certifiedInput = { ...input, role: 'provider' as const, certified: true };
    await inviteUser(supabase, certifiedInput);
    expect(calls[0]).toEqual(['invite-user', { body: certifiedInput }]);
  });

  it('region を含むペイロードもそのまま送る', async () => {
    const { supabase, calls } = stubInvoke({ error: null });
    const regionInput = { ...input, region: '関東' };
    await inviteUser(supabase, regionInput);
    expect(calls[0]).toEqual(['invite-user', { body: regionInput }]);
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

describe('deleteUser', () => {
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

  it('delete-user に userId を送る', async () => {
    const { supabase, calls } = stubInvoke({ error: null });
    await deleteUser(supabase, 'user-1');
    expect(calls[0]).toEqual(['delete-user', { body: { userId: 'user-1' } }]);
  });

  it('EF のエラー本文を掘り出して throw する', async () => {
    const err = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
    });
    const { supabase } = stubInvoke({ error: err });
    await expect(deleteUser(supabase, 'user-1')).rejects.toThrow('forbidden');
  });

  it('userId が空文字なら呼び出さずに例外', async () => {
    const { supabase, calls } = stubInvoke({ error: null });
    await expect(deleteUser(supabase, '')).rejects.toThrow('USER_ID_REQUIRED');
    expect(calls.length).toBe(0);
  });
});

describe('translateDeleteUserError', () => {
  it('既知のエラーを日本語にする', () => {
    expect(translateDeleteUserError(new Error('cannot delete yourself')))
      .toContain('自分自身');
    expect(translateDeleteUserError(new Error('forbidden'))).toContain('管理者のみ');
    expect(translateDeleteUserError(new Error('user has articles'))).toContain('記事');
    expect(translateDeleteUserError(new Error('user has commission tokens'))).toContain('依頼');
  });
  it('未知は汎用メッセージ', () => {
    expect(translateDeleteUserError(new Error('boom'))).toContain('削除に失敗');
  });
});

describe('fetchUserAuthStatus', () => {
  function stubInvoke(result: { data?: unknown; error: unknown }) {
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

  it('user-auth-status を呼び、EF の JSON をそのまま返す', async () => {
    const body = { 'user-1': { confirmed: true, lastSignInAt: '2026-01-01T00:00:00Z' } };
    const { supabase, calls } = stubInvoke({ data: body, error: null });
    const result = await fetchUserAuthStatus(supabase);
    expect(calls[0]).toEqual(['user-auth-status', { body: {} }]);
    expect(result).toEqual(body);
  });

  it('EF のエラー本文を掘り出して throw する', async () => {
    const err = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
    });
    const { supabase } = stubInvoke({ error: err });
    await expect(fetchUserAuthStatus(supabase)).rejects.toThrow('forbidden');
  });
});

describe('resendInvite', () => {
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

  it('resend-invite に userId を送る', async () => {
    const { supabase, calls } = stubInvoke({ error: null });
    await resendInvite(supabase, 'user-1');
    expect(calls[0]).toEqual(['resend-invite', { body: { userId: 'user-1' } }]);
  });

  it('userId が空文字なら呼び出さずに例外', async () => {
    const { supabase, calls } = stubInvoke({ error: null });
    await expect(resendInvite(supabase, '')).rejects.toThrow('USER_ID_REQUIRED');
    expect(calls.length).toBe(0);
  });

  it('EF のエラー本文を掘り出して throw する', async () => {
    const err = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: new Response(JSON.stringify({ error: 'already confirmed' }), { status: 400 }),
    });
    const { supabase } = stubInvoke({ error: err });
    await expect(resendInvite(supabase, 'user-1')).rejects.toThrow('already confirmed');
  });
});

describe('translateResendInviteError', () => {
  it('既知のエラーを日本語にする', () => {
    expect(translateResendInviteError(new Error('already confirmed'))).toContain('確認済み');
    expect(translateResendInviteError(new Error('forbidden'))).toContain('管理者のみ');
    expect(translateResendInviteError(new Error('user not found'))).toContain('見つかりません');
  });
  it('未知は汎用メッセージ', () => {
    expect(translateResendInviteError(new Error('boom'))).toContain('再送信に失敗');
  });
});

describe('settings', () => {
  it('authenticated なら誰でも読める', async () => {
    const s = await fetchSettings(hanaClient);
    expect(s.postIntervalDays).toBeGreaterThanOrEqual(0);
    expect(s.featuredCount).toBeGreaterThanOrEqual(0);
    expect(s.featuredWindowDays).toBeGreaterThanOrEqual(0);
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

  it('admin は featured_window_days を更新できる', async () => {
    const before = await fetchSettings(adminClient);
    try {
      await updateSettings(adminClient, { ...before, featuredWindowDays: before.featuredWindowDays + 1 });
      const after = await fetchSettings(adminClient);
      expect(after.featuredWindowDays).toBe(before.featuredWindowDays + 1);
    } finally {
      await updateSettings(adminClient, before);
    }
  });

  it('不正な値は送信前に弾く', async () => {
    await expect(
      updateSettings(adminClient, { postIntervalDays: -1, featuredCount: 3, featuredWindowDays: 14, pageSize: 2 }),
    ).rejects.toThrow('INVALID_SETTINGS');
    await expect(
      updateSettings(adminClient, { postIntervalDays: 10, featuredCount: 1.5, featuredWindowDays: 14, pageSize: 2 }),
    ).rejects.toThrow('INVALID_SETTINGS');
    await expect(
      updateSettings(adminClient, { postIntervalDays: 10, featuredCount: 3, featuredWindowDays: -1, pageSize: 2 }),
    ).rejects.toThrow('INVALID_SETTINGS');
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

describe('article moderation hold (admin auditing)', () => {
  let articleId: string;

  beforeAll(async () => {
    articleId = await createDraft(hanaClient, {
      title: '審査対象の下書き', slug: '',
      body: [{ type: 'paragraph', content: [{ type: 'text', text: '本文' }] }],
      coverUrl: '', commissionToken: '', region: '関東',
    });
  });

  afterAll(async () => {
    await deleteArticle(hanaClient, articleId);
  });

  it('fetchAllArticlesForAudit は著者名つきで全記事を返す(admin専用)', async () => {
    const all = await fetchAllArticlesForAudit(adminClient);
    const mine = all.find((a) => a.id === articleId);
    expect(mine).toBeDefined();
    expect(mine!.authorName).toBe('田中 花');
    expect(mine!.moderationHold).toBe(false);
  });

  it('writer は他人の記事を審査対象一覧として見られない(RLSで自分の行のみ)', async () => {
    const mine = await fetchAllArticlesForAudit(hanaClient);
    expect(mine.map((a) => a.id)).toContain(articleId);
    for (const a of mine) expect(a.authorName).toBe('田中 花');
  });

  it('admin は理由つきでホールドを設置・解除できる', async () => {
    await setModerationHold(adminClient, articleId, true, '事実誤認の指摘あり');
    let all = await fetchAllArticlesForAudit(adminClient);
    let mine = all.find((a) => a.id === articleId)!;
    expect(mine.moderationHold).toBe(true);
    expect(mine.moderationHoldReason).toBe('事実誤認の指摘あり');

    await setModerationHold(adminClient, articleId, false);
    all = await fetchAllArticlesForAudit(adminClient);
    mine = all.find((a) => a.id === articleId)!;
    expect(mine.moderationHold).toBe(false);
    expect(mine.moderationHoldReason).toBeNull();
  });

  it('理由なしでホールドを設置しようとすると拒否される(クライアント側)', async () => {
    await expect(setModerationHold(adminClient, articleId, true))
      .rejects.toThrow('MODERATION_HOLD_REASON_REQUIRED');
  });

  it('理由なしでホールドを設置しようとすると拒否される(DBトリガー側)', async () => {
    const { error } = await adminClient
      .from('articles').update({ moderation_hold: true }).eq('id', articleId);
    expect(error?.message).toMatch(/requires a reason/);
  });

  it('writer は自分の記事であってもホールドを変更できない(トリガーで拒否)', async () => {
    await expect(setModerationHold(hanaClient, articleId, true, '理由'))
      .rejects.toThrow(/admin/);
  });
});

describe('published_at update (admin)', () => {
  // hana が seed で公開済みの記事(koke-no-mori)を使う。publishedAt は最後に必ず元へ戻す。
  let publishedId: string;
  let originalPublishedAt: string;

  beforeAll(async () => {
    const { data, error } = await adminClient
      .from('articles').select('id, published_at').eq('slug', 'koke-no-mori').single();
    if (error) throw error;
    publishedId = data.id;
    originalPublishedAt = data.published_at;
  });

  afterAll(async () => {
    await updatePublishedAt(adminClient, publishedId, originalPublishedAt);
  });

  it('admin は公開済み記事の公開日時を書き換えられる', async () => {
    const newDate = new Date('2020-01-01T00:00:00.000Z').toISOString();
    await updatePublishedAt(adminClient, publishedId, newDate);
    const all = await fetchAllArticlesForAudit(adminClient);
    expect(new Date(all.find((a) => a.id === publishedId)!.publishedAt!).getTime())
      .toBe(new Date(newDate).getTime());
  });

  it('著者本人が呼んでもトリガーが黙って元の値へ戻す(エラーにはならない)', async () => {
    await updatePublishedAt(adminClient, publishedId, originalPublishedAt);
    await updatePublishedAt(hanaClient, publishedId, new Date('1999-01-01').toISOString());
    const all = await fetchAllArticlesForAudit(adminClient);
    expect(new Date(all.find((a) => a.id === publishedId)!.publishedAt!).getTime())
      .toBe(new Date(originalPublishedAt).getTime());
  });

  it('著者でも admin でもない場合は PUBLISHED_AT_UPDATE_DENIED', async () => {
    await expect(updatePublishedAt(certifiedClient, publishedId, new Date().toISOString()))
      .rejects.toThrow('PUBLISHED_AT_UPDATE_DENIED');
  });

  it('不正な日時は INVALID_PUBLISHED_AT', async () => {
    await expect(updatePublishedAt(adminClient, publishedId, 'not-a-date'))
      .rejects.toThrow('INVALID_PUBLISHED_AT');
    await expect(updatePublishedAt(adminClient, publishedId, ''))
      .rejects.toThrow('INVALID_PUBLISHED_AT');
  });
});
