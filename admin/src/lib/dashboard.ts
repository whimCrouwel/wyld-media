import type { SupabaseClient } from '@supabase/supabase-js';

export interface MyArticle {
  id: string;
  slug: string | null;
  title: string;
  status: 'draft' | 'published';
  publishedAt: string | null;
  isCommissioned: boolean;
}

export async function fetchMyArticles(supabase: SupabaseClient): Promise<MyArticle[]> {
  // RLS により自分の記事だけが返る(下書き含む)
  const { data, error } = await supabase
    .from('articles')
    .select('id, slug, title, status, published_at, commissioned_by, created_at')
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
  }));
}
