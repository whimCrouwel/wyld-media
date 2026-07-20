import type { SupabaseClient } from '@supabase/supabase-js';
import { usedRegions, regionSlug, type Region } from './regions';

export interface AreaLink {
  region: string;
  slug: string;
  href: string;
  count: number;
}

// 記事の取材地の配列から、記事のある地域だけを北→南の順で組み立てる
export function buildAreaLinks(regions: (string | null)[]): AreaLink[] {
  const counts = new Map<string, number>();
  for (const r of regions) {
    if (r) counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  return usedRegions(regions).map((region) => ({
    region,
    slug: regionSlug(region as Region),
    href: `/areas/${regionSlug(region as Region)}`,
    count: counts.get(region) ?? 0,
  }));
}

async function loadAreaLinks(db: SupabaseClient): Promise<AreaLink[]> {
  const { data, error } = await db
    .from('articles')
    .select('region')
    .eq('status', 'published');
  // 地域ナビは全ページの骨格なので、取れないならビルドを落とす。
  // probeAspect と違ってフォールバックしないのは、地域ナビのないページを
  // 黙って何百枚も出力するほうが悪いから。
  if (error) throw error;
  return buildAreaLinks((data ?? []).map((r: { region: string | null }) => r.region));
}

// サイドバーは全ページに出るので、素直に書くと1ページ1クエリ(数百回)になる。
// モジュールは1ビルドにつき1回しか評価されないので、最初の Promise を使い回せば
// 全ページ合わせて1クエリで済む。
let areaLinks: Promise<AreaLink[]> | undefined;

export function getAreaLinks(db: SupabaseClient): Promise<AreaLink[]> {
  return (areaLinks ??= loadAreaLinks(db));
}
