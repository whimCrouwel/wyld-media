-- ライターごとの「料金プラン」テーブル。プロフィールの price_info(単一のテキスト欄)を
-- 構造化された表に置き換える。
--
-- * 公開サイトはビルド時に service role で読み取るので RLS はバイパスされる。
--   → RLS は CMS 内(anon/authenticated 経由)での可視性のみを制御すればよい。
-- * writer 本人: 自分の行のみ CRUD(下書き・公開含む)
-- * admin: 全ライターの行に対して CRUD(モデレーション用)
-- * それ以外の authenticated: 一切見えない(CMS 内で他人の料金を触るユースケースはない)
-- * anon: policy 未付与のため一切見えない
--
-- writer_id は profiles を参照する。profile 削除時は料金も一緒に消える(cascade)。

create table public.pricing_items (
  id uuid primary key default gen_random_uuid(),
  writer_id uuid not null references public.profiles(id) on delete cascade,
  label text not null check (btrim(label) <> ''),
  unit text not null default '',
  amount int not null check (amount >= 0),
  currency text not null default 'JPY' check (currency = 'JPY'),
  sort_order int not null default 0,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index pricing_items_writer_sort_idx
  on public.pricing_items (writer_id, sort_order, created_at);

create trigger pricing_items_set_updated_at
  before update on public.pricing_items
  for each row execute function extensions.moddatetime(updated_at);

grant select, insert, update, delete on public.pricing_items to authenticated;
-- service role は RLS をバイパスするが、テーブルレベルの GRANT は別途必要。
-- 公開サイトのビルド + seed が service role で読み書きする。
grant select, insert, update, delete on public.pricing_items to service_role;

alter table public.pricing_items enable row level security;

create policy "read own pricing or admin all"
  on public.pricing_items for select to authenticated
  using (writer_id = auth.uid() or public.is_admin());

create policy "insert own pricing"
  on public.pricing_items for insert to authenticated
  with check (writer_id = auth.uid() or public.is_admin());

create policy "update own pricing"
  on public.pricing_items for update to authenticated
  using (writer_id = auth.uid() or public.is_admin())
  with check (writer_id = auth.uid() or public.is_admin());

create policy "delete own pricing"
  on public.pricing_items for delete to authenticated
  using (writer_id = auth.uid() or public.is_admin());

-- profiles.price_info はこのテーブルに置き換わるため削除する。
alter table public.profiles drop column price_info;
