import type { SupabaseClient } from '@supabase/supabase-js';
import { REGIONS, regionSlug } from './regions';

export interface AreaLink {
  region: string;
  slug: string;
  href: string;
  count: number;
}

// 記事の取材地の配列から、全地域を北→南の順で組み立てる。
// 記事のない地域も件数0で返すのは、サイドバーがモザイクの日本地図で、
// 1地域でも欠けると地図の形として成立しないため(描画側が淡色・リンクなしにする)。
export function buildAreaLinks(regions: (string | null)[]): AreaLink[] {
  const counts = new Map<string, number>();
  for (const r of regions) {
    if (r) counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  return REGIONS.map((region) => ({
    region,
    slug: regionSlug(region),
    href: `/areas/${regionSlug(region)}`,
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
