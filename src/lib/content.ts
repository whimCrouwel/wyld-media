import type { SupabaseClient } from '@supabase/supabase-js';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

export interface ArticleSummary {
  id: string;
  slug: string;
  title: string;
  coverImageUrl: string | null;
  publishedAt: string;
  authorName: string;
  authorSlug: string;
  commissionedByName: string | null;
}

export interface ArticleDetail extends ArticleSummary {
  bodyHtml: string;
}

export interface WriterSummary {
  slug: string;
  name: string;
  bio: string;
}

export interface WriterDetail extends WriterSummary {
  homepageUrl: string | null;
  snsLinks: unknown;
  priceInfo: string | null;
  contactUrl: string | null;
  articles: ArticleSummary[];
}

// articles は profiles への FK を2本持つため、埋め込みは FK 名で曖昧性解消する
const ARTICLE_SELECT =
  'id, slug, title, cover_image_url, published_at, commissioned_by, ' +
  'author:profiles!articles_author_id_fkey(name, slug), ' +
  'commissioned:profiles!articles_commissioned_by_fkey(name)';

// PostgREST の to-one 埋め込みは環境により object / array 両方があり得るので吸収する
function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function toSummary(row: any): ArticleSummary {
  const author = one<{ name: string; slug: string }>(row.author);
  const commissioned = one<{ name: string }>(row.commissioned);
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    coverImageUrl: row.cover_image_url ?? null,
    publishedAt: row.published_at,
    authorName: author?.name ?? '',
    authorSlug: author?.slug ?? '',
    commissionedByName: commissioned?.name ?? null,
  };
}

export function renderMarkdown(markdown: string): string {
  const html = marked.parse(markdown, { async: false }) as string;
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2']),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: ['src', 'alt'],
    },
  });
}

export async function fetchPublishedArticles(
  db: SupabaseClient,
): Promise<{ featured: ArticleSummary[]; normal: ArticleSummary[] }> {
  const { data: settings, error: settingsError } = await db
    .from('settings')
    .select('featured_count')
    .eq('id', 1)
    .single();
  if (settingsError) throw settingsError;

  const { data, error } = await db
    .from('articles')
    .select(ARTICLE_SELECT)
    .eq('status', 'published')
    .order('published_at', { ascending: false });
  if (error) throw error;

  const rows = (data ?? []).map(toSummary);
  const featuredIds = new Set(
    rows
      .filter((r) => r.commissionedByName !== null)
      .slice(0, settings.featured_count)
      .map((r) => r.id),
  );
  return {
    featured: rows.filter((r) => featuredIds.has(r.id)),
    normal: rows.filter((r) => !featuredIds.has(r.id)),
  };
}

export async function fetchArticleBySlug(
  db: SupabaseClient,
  slug: string,
): Promise<ArticleDetail | null> {
  const { data, error } = await db
    .from('articles')
    .select(`${ARTICLE_SELECT}, body`)
    .eq('status', 'published')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { ...toSummary(data), bodyHtml: renderMarkdown((data as any).body) };
}

export async function fetchWriters(db: SupabaseClient): Promise<WriterSummary[]> {
  const { data, error } = await db
    .from('profiles')
    .select('slug, name, bio')
    .eq('role', 'writer')
    .order('name');
  if (error) throw error;
  return (data ?? []).map((row) => ({ slug: row.slug, name: row.name, bio: row.bio }));
}

export async function fetchWriterBySlug(
  db: SupabaseClient,
  slug: string,
): Promise<WriterDetail | null> {
  const { data: profile, error } = await db
    .from('profiles')
    .select('id, slug, name, bio, homepage_url, sns_links, price_info, contact_url')
    .eq('role', 'writer')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  if (!profile) return null;

  const { data: articles, error: articlesError } = await db
    .from('articles')
    .select(ARTICLE_SELECT)
    .eq('status', 'published')
    .eq('author_id', profile.id)
    .order('published_at', { ascending: false });
  if (articlesError) throw articlesError;

  return {
    slug: profile.slug,
    name: profile.name,
    bio: profile.bio,
    homepageUrl: profile.homepage_url ?? null,
    snsLinks: profile.sns_links ?? [],
    priceInfo: profile.price_info ?? null,
    contactUrl: profile.contact_url ?? null,
    articles: (articles ?? []).map(toSummary),
  };
}
