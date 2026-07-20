-- ライタープロフィールに顔写真(サムネイル)と活動拠点を追加。
-- どちらも本人が自由に編集できる項目なので、保護トリガー(role/commission_code)の対象外。
alter table public.profiles
  add column avatar_url text,
  add column location text;
