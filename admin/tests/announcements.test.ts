import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import {
  validateAnnouncementInput, fetchAnnouncements, formatAnnouncementDate,
  createAnnouncement, updateAnnouncement, deleteAnnouncement,
  type AnnouncementInput,
} from '../src/lib/announcements';

describe('formatAnnouncementDate', () => {
  it('ISO文字列を YYYY/M/D 形式にする', () => {
    // ローカルタイムゾーン依存を避けるため正午UTCではなくローカル日時で組む
    const iso = new Date(2026, 6, 28, 12, 0, 0).toISOString();
    expect(formatAnnouncementDate(iso)).toBe('2026/7/28');
  });
});

const url = process.env.PUBLIC_SUPABASE_URL!;
const anon = process.env.PUBLIC_SUPABASE_ANON_KEY!;

const adminClient = createClient(url, anon, { auth: { persistSession: false } });
const writerClient = createClient(url, anon, { auth: { persistSession: false } });
const providerClient = createClient(url, anon, { auth: { persistSession: false } });

beforeAll(async () => {
  const a = await adminClient.auth.signInWithPassword({
    email: 'admin@seed.local', password: 'seed-pass-1234',
  });
  if (a.error) throw a.error;
  const w = await writerClient.auth.signInWithPassword({
    email: 'hana@seed.local', password: 'seed-pass-1234',
  });
  if (w.error) throw w.error;
  const p = await providerClient.auth.signInWithPassword({
    email: 'forest@seed.local', password: 'seed-pass-1234',
  });
  if (p.error) throw p.error;
});

afterEach(async () => {
  // 各テストで作った行を掃除する(admin なら全件消せる)。
  await adminClient.from('announcements').delete().neq('id', '00000000-0000-0000-0000-000000000000');
});

describe('validateAnnouncementInput', () => {
  const base: AnnouncementInput = {
    title: 'タイトル', body: '本文', audiences: ['writer'], published: false,
  };

  it('正しい入力は null を返す', () => {
    expect(validateAnnouncementInput(base)).toBeNull();
  });

  it('タイトルが空なら文言を返す', () => {
    expect(validateAnnouncementInput({ ...base, title: '  ' })).toBe('タイトルを入力してください');
  });

  it('本文が空なら文言を返す', () => {
    expect(validateAnnouncementInput({ ...base, body: '' })).toBe('本文を入力してください');
  });

  it('対象が0件なら文言を返す', () => {
    expect(validateAnnouncementInput({ ...base, audiences: [] })).toBe('対象を1つ以上選択してください');
  });
});

describe('createAnnouncement / fetchAnnouncements', () => {
  it('admin が作成した非公開のお知らせも fetchAnnouncements(admin) に含まれる', async () => {
    await createAnnouncement(adminClient, {
      title: '下書き', body: '本文', audiences: ['writer'], published: false,
    });
    const list = await fetchAnnouncements(adminClient);
    expect(list.some((a) => a.title === '下書き' && a.published === false)).toBe(true);
  });

  it('writer は公開済み・自分向けのお知らせだけ fetchAnnouncements で見える', async () => {
    await createAnnouncement(adminClient, {
      title: 'ライター向け公開', body: 'w', audiences: ['writer'], published: true,
    });
    await createAnnouncement(adminClient, {
      title: '事業者向け公開', body: 'p', audiences: ['provider'], published: true,
    });
    await createAnnouncement(adminClient, {
      title: 'ライター向け非公開', body: 'w2', audiences: ['writer'], published: false,
    });

    const list = await fetchAnnouncements(writerClient);
    const titles = list.map((a) => a.title);
    expect(titles).toContain('ライター向け公開');
    expect(titles).not.toContain('事業者向け公開');
    expect(titles).not.toContain('ライター向け非公開');
  });

  it('provider は公開済み・自分向けのお知らせだけ見える', async () => {
    await createAnnouncement(adminClient, {
      title: '事業者向け公開2', body: 'p', audiences: ['provider'], published: true,
    });
    const list = await fetchAnnouncements(providerClient);
    expect(list.map((a) => a.title)).toContain('事業者向け公開2');
  });

  it('writer は作成できない(insert が RLS で拒否される)', async () => {
    await expect(createAnnouncement(writerClient, {
      title: 't', body: 'b', audiences: ['writer'], published: true,
    })).rejects.toThrow();
  });

  it('opts.limit を渡すと件数を絞れる', async () => {
    for (let i = 0; i < 3; i++) {
      await createAnnouncement(adminClient, {
        title: `件数テスト${i}`, body: 'b', audiences: ['writer'], published: true,
      });
    }
    const list = await fetchAnnouncements(adminClient, { limit: 2 });
    expect(list.length).toBeLessThanOrEqual(2);
  });
});

describe('updateAnnouncement / deleteAnnouncement', () => {
  it('admin は更新・削除できる', async () => {
    await createAnnouncement(adminClient, {
      title: '更新前', body: 'b', audiences: ['writer'], published: false,
    });
    const [created] = await fetchAnnouncements(adminClient);
    await updateAnnouncement(adminClient, created.id, {
      title: '更新後', body: 'b2', audiences: ['provider'], published: true,
    });
    const afterUpdate = (await fetchAnnouncements(adminClient)).find((a) => a.id === created.id)!;
    expect(afterUpdate.title).toBe('更新後');
    expect(afterUpdate.audiences).toEqual(['provider']);

    await deleteAnnouncement(adminClient, created.id);
    const afterDelete = (await fetchAnnouncements(adminClient)).find((a) => a.id === created.id);
    expect(afterDelete).toBeUndefined();
  });

  it('writer は更新できない(0行 denied)', async () => {
    await createAnnouncement(adminClient, {
      title: '保護対象', body: 'b', audiences: ['writer'], published: true,
    });
    const target = (await fetchAnnouncements(adminClient)).find((a) => a.title === '保護対象')!;
    await expect(updateAnnouncement(writerClient, target.id, {
      title: '書き換え', body: 'b', audiences: ['writer'], published: true,
    })).rejects.toThrow();
  });
});
