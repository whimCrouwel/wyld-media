-- 活動拠点のエリアを選択式にする。
-- 自由入力の location は「拠点の詳細(市町村・山域など)」として残し、region と併用する。
-- 一覧の絞り込みに使う値なので、妥当性は check 制約で DB 層に強制する。
-- 中部は自然・アウトドア文脈での意味が大きいため甲信越/北陸/東海に分割した12区分。
alter table public.profiles
  add column region text
    check (region in (
      '北海道', '東北', '関東', '甲信越', '北陸', '東海',
      '近畿', '中国', '四国', '九州', '沖縄', '海外'
    ));

comment on column public.profiles.region is '活動拠点のエリア(12区分)。未設定は null。';
comment on column public.profiles.location is '拠点の詳細(自由記述)。region の補足。';
