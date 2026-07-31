-- ユーザー削除機能: 記事を持つユーザーの削除を FK でブロックする。
-- 従来は on delete cascade でユーザー削除時に記事も連鎖削除していたが、
-- 誤削除防止のため「記事があれば削除不可」に方針変更する(restrict)。
alter table public.articles
  drop constraint articles_author_id_fkey;

alter table public.articles
  add constraint articles_author_id_fkey
  foreign key (author_id) references public.profiles (id) on delete restrict;
