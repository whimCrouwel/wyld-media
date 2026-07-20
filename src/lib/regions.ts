// 活動拠点のエリア。値の正当性は profiles.region の check 制約(DB層)が最終的な判断で、
// ここは表示順を決めるための一覧(北から南、最後に海外)。
// 制約を変えるときは admin/src/lib/regions.ts と合わせて同じ変更で更新する。
export const REGIONS = [
  '北海道', '東北', '関東', '甲信越', '北陸', '東海',
  '近畿', '中国', '四国', '九州', '沖縄', '海外',
] as const;

export type Region = (typeof REGIONS)[number];

// 実際にライターがいるエリアだけを、REGIONS の並び順で返す
export function usedRegions(values: (string | null)[]): string[] {
  const present = new Set(values.filter((v): v is string => !!v));
  return REGIONS.filter((r) => present.has(r));
}

// URL用のローマ字slug。日本語のままだと %E9%96%A2%E6%9D%B1 になって共有しづらいため。
export const REGION_SLUGS: Record<Region, string> = {
  北海道: 'hokkaido',
  東北: 'tohoku',
  関東: 'kanto',
  甲信越: 'koshinetsu',
  北陸: 'hokuriku',
  東海: 'tokai',
  近畿: 'kinki',
  中国: 'chugoku',
  四国: 'shikoku',
  九州: 'kyushu',
  沖縄: 'okinawa',
  海外: 'overseas',
};

export function regionSlug(region: Region): string {
  return REGION_SLUGS[region];
}

export function regionFromSlug(slug: string): Region | null {
  return REGIONS.find((r) => REGION_SLUGS[r] === slug) ?? null;
}
