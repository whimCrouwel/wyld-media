-- 名前の下に出す肩書き(例: 「環境ライター」「森林インストラクター」)。
-- 自由記述。region/location と違い絞り込みには使わないので check 制約なし。
alter table public.profiles
  add column title text;

comment on column public.profiles.title is '肩書き。名前の下に表示する短い一行(自由記述)。未設定は null。';
