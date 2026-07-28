import probe from 'probe-image-size';
import { formatDate, type ArticleSummary } from './content';
import { regionSlug, type Region } from './regions';

// ギャラリーカード1枚ぶんの表示データ(index.astro → MasonryGrid / FeaturedStrip)
export interface GalleryWork {
  href: string;
  title: string;
  date: string;
  imageUrl: string | null;
  ratio: number;
  number: number; // カタログ番号(新しいほど大きい)
  authorName: string;
  authorHref: string;
  authorAvatarUrl: string | null;
  regionName: string | null;
  regionHref: string | null;
  commissionedByName: string | null;
}

// カバー画像未設定の記事用プレースホルダー(仮運用)。slug をシードにした
// 決定的な picsum.photos URL を返す。本番画像が入り次第この分岐ごと外す。
const PLACEHOLDER_RATIOS = [
  [800, 1000], // 4:5 縦
  [1200, 800], // 3:2 横
  [900, 900], // 正方形
  [1000, 750], // 4:3
  [1200, 750], // 16:10
] as const;

export function placeholderImage(slug: string, index: number): { url: string; ratio: number } {
  const [w, h] = PLACEHOLDER_RATIOS[index % PLACEHOLDER_RATIOS.length];
  return {
    url: `https://picsum.photos/seed/${encodeURIComponent(slug)}/${w}/${h}`,
    ratio: w / h,
  };
}

const FALLBACK_RATIO = 4 / 3;

// ビルド中に同じカバー画像を何度も probe しないためのキャッシュ
const cache = new Map<string, Promise<number>>();

// ビルド時に画像の実寸を取得して aspect-ratio (width/height) を返す。
// 取得できない場合は 4:3 にフォールバックし、ビルドは止めない。
export function probeAspect(url: string): Promise<number> {
  let cached = cache.get(url);
  if (!cached) {
    cached = probe(url)
      .then((r) => (r.width > 0 && r.height > 0 ? r.width / r.height : FALLBACK_RATIO))
      .catch(() => FALLBACK_RATIO);
    cache.set(url, cached);
  }
  return cached;
}

// 記事 → GalleryWork への変換を一箇所に集約する。/ と /areas/xxx が別々に
// この変換を持っていたせいで、number の出し方だけがずれて同じ記事が違う
// カタログ番号を名乗る不具合が起きた。number は呼び出し側が「全作品通し
// 番号」(公開順の全体インデックスから計算した値)を渡す前提で、ここでは
// 採番ロジックを一切持たない。placeholderIndex はカバー画像未設定時の
// 仮画像の見た目を決めるだけの値で、number とは無関係。
export async function buildGalleryWork(
  article: ArticleSummary,
  placeholderIndex: number,
  number: number,
): Promise<GalleryWork> {
  const image = article.coverImageUrl
    ? { url: article.coverImageUrl, ratio: await probeAspect(article.coverImageUrl) }
    : placeholderImage(article.slug, placeholderIndex);
  return {
    href: `/articles/${article.slug}`,
    title: article.title,
    date: formatDate(article.publishedAt),
    imageUrl: image.url,
    ratio: image.ratio,
    number,
    authorName: article.authorName,
    authorHref: `/writers/${article.authorSlug}`,
    authorAvatarUrl: article.authorAvatarUrl,
    regionName: article.region,
    regionHref: article.region ? `/areas/${regionSlug(article.region as Region)}` : null,
    commissionedByName: article.commissionedByName,
  };
}
