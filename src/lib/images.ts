import probe from 'probe-image-size';

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
