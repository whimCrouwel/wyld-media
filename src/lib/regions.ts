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
