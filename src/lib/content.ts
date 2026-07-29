import type { SupabaseClient } from '@supabase/supabase-js';
import { renderBlocksToHtml } from '@wild-media/blocks-renderer';
import { fallbackDescription } from './description';
import { toIsoDate } from './seo';

export interface ArticleSummary {
  id: string;
  slug: string;
  title: string;
  coverImageUrl: string | null;
  publishedAt: string;
  authorName: string;
  authorSlug: string;
  authorAvatarUrl: string | null;
  authorBio: string;
  authorSnsLinks: string[];
  commissionedByName: string | null;
  region: string | null;
  description: string; // Never null — see fallbackDescription when DB value is null/empty.
  publishedAtISO: string | null;
  updatedAtISO: string | null;
}

export interface ArticleHeading {
  id: string;
  text: string;
}

export interface ArticleDetail extends ArticleSummary {
  bodyHtml: string;
  headings: ArticleHeading[];
}

export interface WriterSummary {
  slug: string;
  name: string;
  title: string | null;
  bio: string;
  avatarUrl: string | null;
  region: string | null;
  location: string | null;
}

export interface PricingItemPublic {
  label: string;
  unit: string;
  amount: number;
  currency: string;
}

export interface WriterDetail extends WriterSummary {
  coverImageUrl: string | null;
  homepageUrl: string | null;
  snsLinks: string[];
  contactUrl: string | null;
  pricingItems: PricingItemPublic[];
  articles: ArticleSummary[];
}

export interface ProviderSummary {
  slug: string;
  name: string;
  bio: string;
  avatarUrl: string | null;
  region: string | null;
  location: string | null;
  serviceName: string | null;
  serviceImageUrl: string | null;
}

export interface ProviderDetail extends ProviderSummary {
  coverImageUrl: string | null;
  homepageUrl: string | null;
  snsLinks: string[];
  serviceDescription: string | null;
  serviceUrl: string | null;
}

// packages/blocks-renderer が h2/h3 に付与する id はエンティティ化された見出し
// テキストそのもの(addHeadingIds 参照)。目次のリンク先(href)と実際の id を
// 一致させるため、双方に同じデコードをかけて生テキストに揃える。
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&amp;/g, '&'); // 最後に処理(先にやると "&amp;lt;" → "&lt;" → "<" と二重デコードしてしまう)
}

// 目次表示用に本文HTML中の見出し(h2のみ — h3はネストが複雑になるため対象外)を
// 抽出する。bodyHtml は既に addHeadingIds/sanitize-html を通っており id 属性を
// 持つので、そこから直接読み取る(JSONを別途辿って独自にid生成し直すと、
// レンダラー側のロジック変更時にズレる恐れがあるため)。
export function extractHeadings(bodyHtml: string): ArticleHeading[] {
  const headings: ArticleHeading[] = [];
  const re = /<h2 id="([^"]*)">([\s\S]*?)<\/h2>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(bodyHtml))) {
    headings.push({
      id: decodeHtmlEntities(match[1]),
      text: decodeHtmlEntities(match[2].replace(/<[^>]+>/g, '')),
    });
  }
  return headings;
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
  'id, slug, title, cover_image_url, published_at, updated_at, commissioned_by, region, description, ' +
  'author:profiles!articles_author_id_fkey(name, slug, avatar_url, bio, sns_links), ' +
  'commissioned:profiles!articles_commissioned_by_fkey(name)';

// PostgREST の to-one 埋め込みは環境により object / array 両方があり得るので吸収する
function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function toSummary(row: any): ArticleSummary {
  const author = one<{ name: string; slug: string; avatar_url?: string | null; bio?: string | null; sns_links?: unknown }>(
    row.author,
  );
  const commissioned = one<{ name: string }>(row.commissioned);
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    coverImageUrl: row.cover_image_url ?? null,
    publishedAt: row.published_at,
    publishedAtISO: toIsoDate(row.published_at),
    updatedAtISO: toIsoDate(row.updated_at),
    authorName: author?.name ?? '',
    authorSlug: author?.slug ?? '',
    authorAvatarUrl: safeUrl(author?.avatar_url),
    authorBio: (author?.bio ?? '') as string,
    authorSnsLinks: Array.isArray((author as any)?.sns_links)
      ? (author as any).sns_links.map(safeUrl).filter((u: unknown): u is string => u !== null)
      : [],
    commissionedByName: commissioned?.name ?? null,
    region: row.region ?? null,
    // 一覧系の呼び出し元は本文HTMLを持たないため、descriptionが空ならここでは
    // 空文字のまま返す(記事詳細側は fetchArticleBySlug 内で body由来のフォール
    // バックに差し替える。一覧ページ自体は Task 6 で listing 独自の description
    // を使う想定)。
    description: (row.description ?? '').trim(),
  };
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

// 一覧1ページあたりの記事数。運営が CMS から変えられる(反映は再ビルド時)。
export async function fetchPageSize(db: SupabaseClient): Promise<number> {
  const { data, error } = await db
    .from('settings')
    .select('page_size')
    .eq('id', 1)
    .single();
  if (error) throw error;
  return (data as { page_size: number }).page_size;
}

export async function fetchPublishedArticles(
  db: SupabaseClient,
): Promise<{ featured: ArticleSummary[]; normal: ArticleSummary[] }> {
  const { data: settings, error: settingsError } = await db
    .from('settings')
    .select('featured_count, featured_window_days')
    .eq('id', 1)
    .single();
  if (settingsError) throw settingsError;

  // 全作品通し番号(カタログ番号)はこの並び順から算出され、/ と /areas/xxx の
  // 別々のクエリ間で突き合わされる。published_at が同値だと Postgres の順序は
  // 不定なので、id を second sort key にして両クエリで同じ順序を保証する。
  const { data, error } = await db
    .from('articles')
    .select(ARTICLE_SELECT)
    .eq('status', 'published')
    .eq('moderation_hold', false)
    .order('published_at', { ascending: false })
    .order('id');
  if (error) throw error;

  const rows = (data ?? []).map(toSummary);
  // Featured帯は「依頼記事である」だけでなく「公開から featured_window_days 日以内」も
  // 条件にする。件数上限だけだと依頼記事が増えるほど古いものがいつまでも居座ってしまう
  // ため、帯には直近のものだけを出し、外れたものは通常記事として扱う(PRバッジ自体は
  // buildGalleryWork 側で commissionedByName から常時出すので、帯落ちしても消えない)。
  const featuredCutoff = Date.now() - settings.featured_window_days * 24 * 60 * 60 * 1000;
  const featuredIds = new Set(
    rows
      .filter((r) => r.commissionedByName !== null && new Date(r.publishedAt).getTime() >= featuredCutoff)
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
    .eq('moderation_hold', false)
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const imageBaseUrl = await fetchImageBaseUrl(db);
  const summary = toSummary(data);
  const bodyHtml = await renderBlocksToHtml({ type: 'doc', content: (data as any).body }, imageBaseUrl);
  return {
    ...summary,
    bodyHtml,
    headings: extractHeadings(bodyHtml),
    // 記事詳細は本文HTMLを持つので、DB側のdescriptionが空なら本文由来の
    // フォールバックに差し替える(toSummaryの時点では空文字のまま)。
    description: summary.description || fallbackDescription(bodyHtml),
  };
}

export async function fetchWriters(db: SupabaseClient): Promise<WriterSummary[]> {
  // 公開記事(status=published かつ moderation_hold=false)を1本も持たないライターは
  // プロフィール自体を公開サイトに出さない(articles!inner で絞り込み)。
  const { data, error } = await db
    .from('profiles')
    .select('slug, name, title, bio, avatar_url, region, location, articles!articles_author_id_fkey!inner(id)')
    .eq('role', 'writer')
    .eq('articles.status', 'published')
    .eq('articles.moderation_hold', false)
    .order('name');
  if (error) throw error;
  return (data ?? []).map((row) => ({
    slug: row.slug,
    name: row.name,
    title: row.title ?? null,
    bio: row.bio,
    avatarUrl: safeUrl(row.avatar_url),
    region: row.region ?? null,
    location: row.location ?? null,
  }));
}

export async function fetchWriterBySlug(
  db: SupabaseClient,
  slug: string,
): Promise<WriterDetail | null> {
  const { data: profile, error } = await db
    .from('profiles')
    .select(
      'id, slug, name, title, bio, avatar_url, cover_image_url, region, location, homepage_url, sns_links, contact_url',
    )
    .eq('role', 'writer')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  if (!profile) return null;

  const { data: articles, error: articlesError } = await db
    .from('articles')
    .select(ARTICLE_SELECT)
    .eq('status', 'published')
    .eq('moderation_hold', false)
    .eq('author_id', profile.id)
    .order('published_at', { ascending: false });
  if (articlesError) throw articlesError;

  // 公開料金のみ、sort_order 昇順で(admin側で入れた並びをそのまま反映)。
  const { data: pricing, error: pricingError } = await db
    .from('pricing_items')
    .select('label, unit, amount, currency')
    .eq('writer_id', profile.id)
    .eq('published', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (pricingError) throw pricingError;

  return {
    slug: profile.slug,
    name: profile.name,
    title: profile.title ?? null,
    bio: profile.bio,
    avatarUrl: safeUrl(profile.avatar_url),
    coverImageUrl: safeUrl(profile.cover_image_url),
    region: profile.region ?? null,
    location: profile.location ?? null,
    homepageUrl: safeUrl(profile.homepage_url),
    snsLinks: Array.isArray(profile.sns_links)
      ? profile.sns_links.map(safeUrl).filter((u): u is string => u !== null)
      : [],
    contactUrl: safeUrl(profile.contact_url),
    pricingItems: (pricing ?? []).map((r) => ({
      label: r.label,
      unit: r.unit,
      amount: r.amount,
      currency: r.currency,
    })),
    articles: (articles ?? []).map(toSummary),
  };
}

// 認定プロバイダーのみ(未認定は一覧にも詳細にも出さない — certified の意味を
// 薄めないため。詳細ページ側も同じ条件で絞るので、URL を直接叩かれても出ない)。
export async function fetchProviders(db: SupabaseClient): Promise<ProviderSummary[]> {
  const { data, error } = await db
    .from('profiles')
    .select('slug, name, bio, avatar_url, region, location, service_name, service_image_url')
    .eq('role', 'provider')
    .eq('certified', true)
    .order('name');
  if (error) throw error;
  return (data ?? []).map((row) => ({
    slug: row.slug,
    name: row.name,
    bio: row.bio,
    avatarUrl: safeUrl(row.avatar_url),
    region: row.region ?? null,
    location: row.location ?? null,
    serviceName: row.service_name ?? null,
    serviceImageUrl: safeUrl(row.service_image_url),
  }));
}

export async function fetchProviderBySlug(
  db: SupabaseClient,
  slug: string,
): Promise<ProviderDetail | null> {
  const { data: profile, error } = await db
    .from('profiles')
    .select(
      'slug, name, bio, avatar_url, cover_image_url, region, location, homepage_url, sns_links, ' +
        'service_name, service_description, service_url, service_image_url',
    )
    .eq('role', 'provider')
    .eq('certified', true)
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  if (!profile) return null;

  return {
    slug: profile.slug,
    name: profile.name,
    bio: profile.bio,
    avatarUrl: safeUrl(profile.avatar_url),
    coverImageUrl: safeUrl(profile.cover_image_url),
    region: profile.region ?? null,
    location: profile.location ?? null,
    homepageUrl: safeUrl(profile.homepage_url),
    snsLinks: Array.isArray(profile.sns_links)
      ? profile.sns_links.map(safeUrl).filter((u): u is string => u !== null)
      : [],
    serviceName: profile.service_name ?? null,
    serviceDescription: profile.service_description ?? null,
    serviceUrl: safeUrl(profile.service_url),
    serviceImageUrl: safeUrl(profile.service_image_url),
  };
}

// 「関連記事」— 同じ著者 かつ 同じ region を最優先、次に著者一致、次に region 一致、
// 最後に最新記事。draft/held は常に除外。ソース記事自体も除外。呼び出し側は Article
// ページからのみ想定(記事詳細を1本立ち上げるコストは既に払っているため)。
export async function fetchRelatedArticles(
  db: SupabaseClient,
  article: ArticleSummary,
  opts: { limit?: number } = {},
): Promise<ArticleSummary[]> {
  const limit = opts.limit ?? 6;
  // 素直に candidates を広めに取ってきてからJS側で優先度スコアで並べ替える。
  // article数がスケールしても、上限は「同一region + 同一著者 + 新着」の和なので過大にはならない。
  const { data, error } = await db
    .from('articles')
    .select(ARTICLE_SELECT)
    .eq('status', 'published')
    .eq('moderation_hold', false)
    .neq('id', article.id)
    .order('published_at', { ascending: false })
    .limit(60); // 60本まで見れば十分な候補プール
  if (error) throw error;

  const candidates = (data ?? []).map(toSummary);
  const score = (c: ArticleSummary) => {
    let s = 0;
    if (c.authorSlug === article.authorSlug) s += 2;
    if (c.region && c.region === article.region) s += 1;
    return s;
  };
  return candidates
    .map((c) => ({ c, s: score(c) }))
    .sort((a, b) => b.s - a.s || (a.c.publishedAt < b.c.publishedAt ? 1 : -1))
    .slice(0, limit)
    .map(({ c }) => c);
}
