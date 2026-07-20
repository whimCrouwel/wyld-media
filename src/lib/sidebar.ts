import type { SupabaseClient } from '@supabase/supabase-js';
import { usedRegions, regionSlug, type Region } from './regions';

export interface AreaLink {
  region: string;
  slug: string;
  href: string;
  count: number;
}

export interface SidebarData {
  areas: AreaLink[];
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

// サイドバーは全ページに出るので、素直に書くと1ページ1クエリ(数百回)になる。
// ビルド中は1回だけ実行して使い回す(src/lib/images.ts の probeAspect と同じ手口)。
let cached: Promise<SidebarData> | null = null;

export function getSidebarData(db: SupabaseClient): Promise<SidebarData> {
  if (!cached) {
    cached = (async () => {
      const { data, error } = await db
        .from('articles')
        .select('region')
        .eq('status', 'published');
      if (error) throw error;
      const regions = (data ?? []).map((r: { region: string | null }) => r.region);
      return { areas: buildAreaLinks(regions) };
    })();
  }
  return cached;
}
