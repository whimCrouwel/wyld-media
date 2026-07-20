-- 記事の取材地。profiles.region(ライターの活動拠点)とは意味の違う別カラムで、
-- 東京在住のライターが屋久島の記事を書いたら「九州」に並ぶ、という読者の期待に合わせる。
-- 一覧の絞り込みに使う値なので、妥当性は check 制約で DB 層に強制する。
alter table public.articles
  add column region text
    check (region in (
      '北海道', '東北', '関東', '甲信越', '北陸', '東海',
      '近畿', '中国', '四国', '九州', '沖縄', '海外'
    ));

-- 下書きは取材地なしで保存できるが、公開するときだけ必須。
-- 既存の published_requires_slug と同じ形。
alter table public.articles
  add constraint published_requires_region
    check (status = 'draft' or region is not null);

-- 一覧ページ1枚あたりの記事数。公開サイトは静的ビルドなので、変更の反映には再ビルドが要る
-- (featured_count と同じ条件)。
alter table public.settings
  add column page_size int not null default 2 check (page_size >= 1);

comment on column public.articles.region is '取材地(12区分)。公開時は必須。';
comment on column public.settings.page_size is '一覧ページ1枚あたりの記事数。';
