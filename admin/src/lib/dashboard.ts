import type { SupabaseClient } from '@supabase/supabase-js';

export interface MyArticle {
  id: string;
  slug: string | null;
  title: string;
  status: 'draft' | 'published';
  publishedAt: string | null;
  isCommissioned: boolean;
  moderationHold: boolean;
  moderationHoldReason: string | null;
}

export async function fetchMyArticles(supabase: SupabaseClient): Promise<MyArticle[]> {
  // RLS により自分の記事だけが返る(下書き含む)
  const { data, error } = await supabase
    .from('articles')
    .select(
      'id, slug, title, status, published_at, commissioned_by, created_at, ' +
      'moderation_hold, moderation_hold_reason',
    )
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    status: row.status,
    publishedAt: row.published_at,
    isCommissioned: row.commissioned_by !== null,
    moderationHold: row.moderation_hold,
    moderationHoldReason: row.moderation_hold_reason,
  }));
}

// 依頼記事(commissioned_by あり)は投稿間隔の対象外(enforce_publish_rules トリガー参照)。
// ここでは通常記事の直近公開日から次に投稿できる日を計算する(投稿可能なら null)。
export function nextEligiblePublishDate(
  articles: MyArticle[],
  postIntervalDays: number,
): Date | null {
  const lastNormalPublishedAt = articles
    .filter((a) => a.status === 'published' && !a.isCommissioned && a.publishedAt)
    .map((a) => a.publishedAt as string)
    .sort()
    .at(-1);
  if (!lastNormalPublishedAt) return null;
  const next = new Date(lastNormalPublishedAt);
  next.setDate(next.getDate() + postIntervalDays);
  return next.getTime() > Date.now() ? next : null;
}
