// 活動拠点のエリア。値の正当性は profiles.region の check 制約(DB層)が最終的な判断で、
// ここはフォームの選択肢を作るための一覧。制約を変えるときは両方を同じ変更で更新する。
export const REGIONS = [
  '北海道', '東北', '関東', '甲信越', '北陸', '東海',
  '近畿', '中国', '四国', '九州', '沖縄', '海外',
] as const;

export type Region = (typeof REGIONS)[number];

export function isRegion(value: string): value is Region {
  return (REGIONS as readonly string[]).includes(value);
}
