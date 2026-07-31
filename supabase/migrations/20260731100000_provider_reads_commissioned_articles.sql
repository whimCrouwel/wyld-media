-- プロバイダーは自分が依頼した(= 自分のトークンで解決された)記事を SELECT できる。
-- CMS の依頼一覧(/commission・/commissions)は commission_tokens に articles(id, title) を
-- 埋め込んでトークンの使用済み判定をしており、記事行が見えないプロバイダーには
-- 使用済みトークンが「未使用」と表示されてしまうため。
-- commissioned_by はトリガー a_resolve_commission_token がトークンの provider_id から
-- サーバー側で解決する値なので、なりすましはできない。
create policy "commissioning provider reads own commissioned articles"
  on public.articles for select to authenticated
  using (commissioned_by = auth.uid());
