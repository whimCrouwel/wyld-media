-- プロバイダー(認定企業)が紹介できる主要サービス情報。1社1件。
-- 顔写真・カバー画像と同様、本人が自由に編集できる項目なので保護トリガーの対象外。
alter table public.profiles
  add column service_name text,
  add column service_description text,
  add column service_url text,
  add column service_image_url text;
