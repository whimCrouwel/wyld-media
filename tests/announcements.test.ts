import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import {
  fetchLatestEndUserAnnouncement, shouldShowAnnouncement,
} from '../src/lib/announcements';

describe('shouldShowAnnouncement', () => {
  it('未表示(dismissedIdがnull)なら表示する', () => {
    expect(shouldShowAnnouncement('abc', null)).toBe(true);
  });

  it('同じIDを閉じていれば表示しない', () => {
    expect(shouldShowAnnouncement('abc', 'abc')).toBe(false);
  });

  it('別のIDを閉じていた場合は表示する(新しいお知らせ)', () => {
    expect(shouldShowAnnouncement('new-id', 'old-id')).toBe(true);
  });
});

describe('fetchLatestEndUserAnnouncement (RLS)', () => {
  const serviceClient = createClient(
    process.env.PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const anonClient = createClient(
    process.env.PUBLIC_SUPABASE_URL!,
    process.env.PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );

  const ids = {
    publishedEndUser: '00000000-0000-0000-0000-0000000000a1',
    unpublishedEndUser: '00000000-0000-0000-0000-0000000000a2',
    publishedWriterOnly: '00000000-0000-0000-0000-0000000000a3',
  };

  beforeAll(async () => {
    const { error } = await serviceClient.from('announcements').insert([
      { id: ids.publishedEndUser, title: '公開バナー', body: '本文e',
        audiences: ['end_user'], published: true },
      { id: ids.unpublishedEndUser, title: '下書きバナー', body: '本文d',
        audiences: ['end_user'], published: false },
      { id: ids.publishedWriterOnly, title: 'ライター向け', body: '本文w',
        audiences: ['writer'], published: true },
    ]);
    if (error) throw error;
  });

  afterAll(async () => {
    await serviceClient.from('announcements').delete().in('id', Object.values(ids));
  });

  it('anon には公開済み・end_user向けの最新1件だけが見える', async () => {
    const result = await fetchLatestEndUserAnnouncement(anonClient);
    expect(result).toEqual({
      id: ids.publishedEndUser, title: '公開バナー', body: '本文e',
    });
  });
});
