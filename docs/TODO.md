# TODO / 課題バックログ

作業中に見つかったが本題と関係ない、または今すぐ直さなくてもいいバグ・改善点を記録する場所。
都度立ち止まって直すのではなく、ここに追記して本題を続け、一段落したタイミングでまとめて解消する。
解消したらチェックを付ける(削除はしない。いつ・何が問題だったかの記録として残す)。

## Open

- [ ] admin のサイト設定画面で「設定の読み込みに失敗しました」と表示される — `admin/src/pages/settings.astro:71`
- [ ] 同じ設定画面で、現在の設定値がフォームに表示されない(空欄になる) — 取得: `admin/src/lib/admin.ts:110-119`(`fetchSettings`)、フォームへの反映: `admin/src/pages/settings.astro:67-69`
  - **調査結果(再現できず)**: `settings` テーブルの行(id=1)・RLSポリシー・grant・ログイン込みの実ブラウザ再現・関連テスト(`admin/tests/admin.test.ts` 含む `npm test`/`admin npm test` 全パス)すべて正常。両症状は同一原因(`fetchSettings` が例外を投げると `settings.astro:67-69` のフォーム反映がスキップされ、同じ catch で `:71` のエラー文言が出る)であることは意図的に `page_size` カラムを一時的に落として確認済みだが、現在の環境ではその原因が存在しない。有力な仮説: `page_size` 列を追加した `supabase/migrations/20260720160000_article_region_and_page_size.sql` が直近(2026-07-20)に追加されたばかりで、報告時点でこのマイグレーションが未適用のローカルDBを見ていた可能性(スキーマドリフト)。**要確認**: `supabase db reset`(または `supabase migration up`)して最新マイグレーションを当てた状態で `/settings` を開いても再現するか。再現しなければ「マイグレーション適用漏れが原因、解消済み」としてチェックを付けられる。再現する場合はブラウザのコンソール/ネットワークの実際のエラー内容が必要。
 [ ] (環境起因、上とは別件)`supabase test db` 実行時に `supabase/tests/database/02_rls.test.sql` のテスト11(「admin sees all articles」)が `have: 9, want: 3` で失敗する — `npm run seed` で作成済みの記事がDBに残っている状態でpgTATテストを実行すると、テスト側が期待する「クリーンな状態+3件追加」という前提が崩れるため。テスト実行前にDBをリセットすれば再現しないはずで、テスト隔離の問題(seed後に`supabase test db`を実行する運用が悪いのか、テスト側がseedデータの存在を考慮すべきか)。

- [ ] `triggerChunking()`(`admin/src/lib/search-index.ts:7`)が `chunk-article` 呼び出し失敗を `console.warn` で握りつぶすだけで、記事が「公開済みだが検索不可」の状態になっても管理者に見える形での警告や再インデックス(バックフィル)手段がない — 対応は今回見送り、将来対応として記録のみ。

- [ ] 検索結果に検索語と無関係な記事が混ざる(関連度の足切りがない)— `search_articles_hybrid`(`supabase/migrations/20260713100100_search_articles_hybrid.sql`)はベクトル検索(上位50件)とPGroongaフルテキスト検索(上位50件)をRRFで `full outer join` しており、どちらか一方の上位50件に入っているだけで実質無関係な記事にも `score` が付いて返ってしまう。呼び出し元 `supabase/functions/search-articles/index.ts:54-58` は `match_count: 10` 固定で、`score` による足切りをしていないため、関連する記事が1〜2件しかなくても残りの枠が弱い一致で埋まる。対応案: `score`(RRF値)に最低閾値を設けて足切りする、閾値未満しかない場合は0件(「見つかりませんでした」)として返す。閾値の具体的な値はサンプルクエリでの実測が必要。

- [ ] プロバイダー⇔ライターの依頼トークン制フロー(設計中、`docs/superpowers/specs/` に依頼トークン設計spec予定)で、両者がプロセス(依頼→トークン発行→オフライン交渉→公開時にトークン入力)を理解できるよう説明するポップアップUIが必要。今回のスコープでは見送り、実装は次回。対象になりそうな箇所: プロバイダー側の依頼UI(新規)、`admin/src/pages/articles/new.astro`・`edit.astro` のトークン入力欄まわり。

- [ ] Supabase の DB コンテナが再起動すると、`dev:all` を再起動せずに使い続けているとトップページの WORKS/FEATURED セクションが記事0件のまま表示される(サイドバーの地域件数は正しく出るので、DB自体・`getAreaLinks` は無関係)。おそらくトップページ側の記事取得も同様のモジュールレベルの1回きりメモ化パターンで、DB再起動でその瞬間のクエリが失敗/空振りした結果がプロセス生存中ずっとキャッシュされていると見られる(再現待ち・要確認)。回避策: `npm run dev:all` を再起動すれば直る。

- [ ] `cd admin && npm test` が稀に `tests/dashboard.test.ts` の「hana の記事は5本」assertion で失敗する(単独実行では常に成功) — `tests/commissions.test.ts` の「revoking a used token fails」テストが hana 名義の記事を一時的に insert → delete しており(`admin/tests/commissions.test.ts:70-77`)、vitest がテストファイルを並列実行するため、`dashboard.test.ts` の記事数カウントがそのタイミングと衝突するとズレる。テスト隔離の問題(ファイル単位の並列実行 + 同一の実DBを共有しているのが根本原因)で、今回のスコープでは見送り。対応案: `commissions.test.ts` 側で一時記事を別ユーザー(hana 以外)名義にする、または vitest 側でこの2ファイルを直列化する。

- [ ] プロバイダーの「主要サービス」情報(`profiles.service_name`/`service_description`/`service_url`/`service_image_url`)と認定フラグ(`profiles.certified`)が、CMSで編集・admin管理はできるが公開サイト側にまだ一切表示されていない。認定済みプロバイダーのみサービス情報を公開する、というのが本来の狙い(`ARCHITECTURE.md` 参照)。対象になりそうな箇所: 公開サイトのプロバイダー用ページ(未作成)、または `src/pages/articles/[slug].astro:30` の「提供: {name}」表示の拡張。認定事業者バッジの公開サイト表示もこのタイミングで検討。

- [ ] インタビュー・ブロックの発言テキストが `<p>` で包まれず、`src/styles/global.css` の `.article-body .interview-block .turn p` バブル背景ルールが効かない。`Turn.content` を `'paragraph+'` に変えるか、`packages/blocks-renderer/src/render.ts` の `injectInterviewSpeakers` で turn 内テキストを `<p>` で包む対応が必要。関連: `packages/blocks-renderer/src/extensions.ts` の Turn ノード定義、`src/styles/global.css` の該当 CSS。

## Done

- [x] **ルートの `npm test` が `tests/life-sim.test.ts` の import で失敗する** — `src/lib/life-sim.ts` は既に削除済みだったのでテスト側も削除して整合。関連commit: (次のcommit)。

- [x] **インタビュー・ダイアログの「自分のプロフィール画像を使う」ボタンが、プロフィール画像URLが `settings.image_base_url` 配下でない場合にそのままセットしてしまう問題** — `admin/src/lib/interview-dialog.ts` に `imageBaseUrl` を渡し、`myProfile.avatarUrl.startsWith(imageBaseUrl)` でチェック。一致しない場合はボタンを `disabled` + `title` 属性で理由を表示、クリックハンドラでも二重チェック。`edit.astro`・`new.astro` ともに既存の `fetchImageBaseUrl` の結果を渡すよう修正。テスト 2 件追加(disable される / enable されて動作する)。E2Eで発見(2026-07-26)、同日修正。

- [x] **本番招待メール用に Resend SMTP を Supabase Auth に配線**。`vim@wyld-crd.org` で新規 Resend アカウント作成 → `send.wyld-crd.org` を Squarespace DNS(MX/SPF/DKIM/DMARC)で verify → API key を Supabase Dashboard → Authentication → SMTP Settings に投入(sender: `zine@send.wyld-crd.org`)。Supabase 側は "Successfully updated settings" で確定。実送信テストは別途 CMS から。関連: `supabase/functions/invite-user/index.ts:61`、認証情報は `PRODUCTION-SECRETS.local.md` の Resend セクション。

- [x] 検索機能で記事が返ってこない(以前は動いていた) — 原因: コード側(RPC・`profiles` inner join・Edge Function・`OPENAI_API_KEY`)はすべて正常、`public.post_chunks` が空なのが真因(`scripts/seed.mjs` が記事投入後に検索インデックスを作っていなかった)。修正: `scripts/seed.mjs` が記事投入後、CMSと同じコードパス(Edge Function `chunk-article`、admin としてサインインしたJWTで呼び出し)で `post_chunks` を構築するよう変更。Edge Functions未起動時は明確なエラーで失敗するようにした。`README.md`/`CLAUDE.md` のセットアップ手順も更新済み(`npm run seed` 前に `npm run dev:fn` が必要になった旨)。検証: seed後 `post_chunks` 0→5件、`search-articles` 呼び出しで実際に検索結果が返ることを確認、再実行しても重複しないことを確認(idempotent)。関連: `triggerChunking()` の失敗握りつぶし・バックフィル不在は別問題として上記 Open に起票。
