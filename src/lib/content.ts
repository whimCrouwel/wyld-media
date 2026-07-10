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
  snsLinks: string[];
  priceInfo: string | null;
  contactUrl: string | null;
  articles: ArticleSummary[];
}

// http(s) 以外のスキーム(javascript: 等)を弾き、書式不正な文字列も null にする
export function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

// ビルド実行環境のタイムゾーンに依存せず常に JST で日付表示する
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' });
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

// imageBaseUrl 配下でない img は丸ごと落とす。空文字なら画像を一切通さない
// (settings.image_base_url 未設定時の fail closed)。
// base + '/' で比較するのは https://img.test が
// https://img.test.evil.example に前方一致するのを防ぐため。
export function renderMarkdown(markdown: string, imageBaseUrl: string): string {
  const html = marked.parse(markdown, { async: false }) as string;
  const prefix = imageBaseUrl === '' ? null : `${imageBaseUrl}/`;
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2']),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: ['src', 'alt'],
    },
    exclusiveFilter: (frame) =>
      frame.tag === 'img' &&
      (prefix === null || !(frame.attribs.src ?? '').startsWith(prefix)),
  });
}

export async function fetchImageBaseUrl(db: SupabaseClient): Promise<string> {
  const { data, error } = await db
    .from('settings')
    .select('image_base_url')
    .eq('id', 1)
    .single();
  if (error) throw error;
  return (data as { image_base_url: string }).image_base_url;
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
  const imageBaseUrl = await fetchImageBaseUrl(db);
  return { ...toSummary(data), bodyHtml: renderMarkdown((data as any).body, imageBaseUrl) };
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
    homepageUrl: safeUrl(profile.homepage_url),
    snsLinks: Array.isArray(profile.sns_links)
      ? profile.sns_links.map(safeUrl).filter((u): u is string => u !== null)
      : [],
    priceInfo: profile.price_info ?? null,
    contactUrl: safeUrl(profile.contact_url),
    articles: (articles ?? []).map(toSummary),
  };
}
