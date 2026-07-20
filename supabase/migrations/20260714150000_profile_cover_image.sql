-- ライタープロフィールにカバー画像(プロフィール上部のバナー)を追加。
-- 顔写真・活動拠点と同様、本人が自由に編集できる項目なので保護トリガーの対象外。
alter table public.profiles
  add column cover_image_url text;
