import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { fetchMyArticles } from '../src/lib/dashboard';

// .env は vitest.config の setupFiles: ['dotenv/config'] で読み込まれる
const supabase = createClient(
  process.env.PUBLIC_SUPABASE_URL!,
  process.env.PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } },
);

beforeAll(async () => {
  const { error } = await supabase.auth.signInWithPassword({
    email: 'hana@seed.local',
    password: 'seed-pass-1234',
  });
  if (error) throw error;
});

describe('fetchMyArticles (requires seeded local Supabase)', () => {
  it('returns only the logged-in writer own articles including the draft', async () => {
    const articles = await fetchMyArticles(supabase);
    // hana の記事: 公開4本(通常2 + 依頼2)+ 下書き1本 = 5本
    expect(articles.length).toBe(5);
    // 下書きが含まれる
    expect(articles.some((a) => a.status === 'draft')).toBe(true);
    // 依頼記事フラグが立つものがある
    expect(articles.some((a) => a.isCommissioned)).toBe(true);
    // 他人(sato-kenta)の記事は入らない = すべて自分のもの。slug で確認
    const slugs = articles.map((a) => a.slug);
    expect(slugs).not.toContain('toshi-no-yachou');
    expect(slugs).toContain('kawabe-kansatsu');
    // シード記事はどれも審査ホールド対象ではない
    expect(articles.every((a) => a.moderationHold === false)).toBe(true);
  });
});
