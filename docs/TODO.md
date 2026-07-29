# TODO / 課題バックログ

作業中に見つかったが本題と関係ない、または今すぐ直さなくてもいいバグ・改善点を記録する場所。
都度立ち止まって直すのではなく、ここに追記して本題を続け、一段落したタイミングでまとめて解消する。
解消したらチェックを付ける(削除はしない。いつ・何が問題だったかの記録として残す)。

## Open

- [ ] `profiles.title`(肩書き)がプロバイダー側(`src/pages/providers/index.astro`・`src/pages/providers/[slug].astro`、`src/lib/content.ts` の `ProviderSummary`/`ProviderDetail`)にまだ未反映 — ライター側(`WriterSummary`/`WriterDetail` と writers の一覧・詳細ページ)は本対応で反映済み(2026-07-29)。同じパターンで `select` に `title` を足し、名前の下に表示すればよい。
- [ ] `src/pages/providers/index.astro` のカードレイアウトが、ライター一覧で直した「AREA/LOCATIONチップ + 2カラムグリッド」デザイン以前の古い1カラム横並び行のまま(2026-07-29、ライター一覧のカードデザイン改修時に気付いた)。
- [ ] 添付ファイル(PDF、`kind: 'file'`)は `media` テーブルに記録されない — `admin/src/lib/block-uploads.ts` の `insertFileBlock` が `uploadToR2` 直呼びで `recordMedia` を通らないため。(1) メディアライブラリに出ない=再利用できない、(2) 週次の `cleanup-orphaned-media` は `media` 行ベースなので、記事から外した後の PDF は R2 に永久に残る(誤削除はされないが掃除もされない)。ライブラリで画像とファイルを区別して表示する UI(`admin/src/lib/media-picker.ts` は現状 `<img>` 前提)もセットで要検討。(2026-07-28、カバー画像のライブラリ選択対応中に気付いた)
- [ ] admin のサイト設定画面で「設定の読み込みに失敗しました」と表示される — `admin/src/pages/settings.astro:71`
- [ ] 同じ設定画面で、現在の設定値がフォームに表示されない(空欄になる) — 取得: `admin/src/lib/admin.ts:110-119`(`fetchSettings`)、フォームへの反映: `admin/src/pages/settings.astro:67-69`
  - **調査結果(再現できず)**: `settings` テーブルの行(id=1)・RLSポリシー・grant・ログイン込みの実ブラウザ再現・関連テスト(`admin/tests/admin.test.ts` 含む `npm test`/`admin npm test` 全パス)すべて正常。両症状は同一原因(`fetchSettings` が例外を投げると `settings.astro:67-69` のフォーム反映がスキップされ、同じ catch で `:71` のエラー文言が出る)であることは意図的に `page_size` カラムを一時的に落として確認済みだが、現在の環境ではその原因が存在しない。有力な仮説: `page_size` 列を追加した `supabase/migrations/20260720160000_article_region_and_page_size.sql` が直近(2026-07-20)に追加されたばかりで、報告時点でこのマイグレーションが未適用のローカルDBを見ていた可能性(スキーマドリフト)。**要確認**: `supabase db reset`(または `supabase migration up`)して最新マイグレーションを当てた状態で `/settings` を開いても再現するか。再現しなければ「マイグレーション適用漏れが原因、解消済み」としてチェックを付けられる。再現する場合はブラウザのコンソール/ネットワークの実際のエラー内容が必要。
 [ ] (環境起因、上とは別件)`supabase test db` 実行時に `supabase/tests/database/02_rls.test.sql` のテスト11(「admin sees all articles」)が `have: 9, want: 3` で失敗する — `npm run seed` で作成済みの記事がDBに残っている状態でpgTATテストを実行すると、テスト側が期待する「クリーンな状態+3件追加」という前提が崩れるため。テスト実行前にDBをリセットすれば再現しないはずで、テスト隔離の問題(seed後に`supabase test db`を実行する運用が悪いのか、テスト側がseedデータの存在を考慮すべきか)。

- [ ] `triggerChunking()`(`admin/src/lib/search-index.ts:7`)が `chunk-article` 呼び出し失敗を `console.warn` で握りつぶすだけで、記事が「公開済みだが検索不可」の状態になっても管理者に見える形での警告や再インデックス(バックフィル)手段がない — 対応は今回見送り、将来対応として記録のみ。

- [ ] `supabase/tests/database/11_search_articles_hybrid.test.sql:65` のコメントが記事F(離れた記事)のベクトル距離を「≈0.5527」としているが、実測(`'[1,0]'::vector(2) <=> '[0.3,0.7]'::vector(2)`)は0.6061で、コメントの数値が古い/誤り。テスト自体のアサーションは実際の距離(0.6061)を前提に正しく動いている(2026-07-28、`20260728120000_search_articles_hybrid_relax_threshold.sql` の閾値変更検証中に気付いた)。コメント修正のみ、動作影響なし。


- [ ] Supabase の DB コンテナが再起動すると、`dev:all` を再起動せずに使い続けているとトップページの WORKS/FEATURED セクションが記事0件のまま表示される(サイドバーの地域件数は正しく出るので、DB自体・`getAreaLinks` は無関係)。おそらくトップページ側の記事取得も同様のモジュールレベルの1回きりメモ化パターンで、DB再起動でその瞬間のクエリが失敗/空振りした結果がプロセス生存中ずっとキャッシュされていると見られる(再現待ち・要確認)。回避策: `npm run dev:all` を再起動すれば直る。

- [ ] `cd admin && npm test` が稀に `tests/dashboard.test.ts` の「hana の記事は5本」assertion で失敗する(単独実行では常に成功) — `tests/commissions.test.ts` の「revoking a used token fails」テストが hana 名義の記事を一時的に insert → delete しており(`admin/tests/commissions.test.ts:70-77`)、vitest がテストファイルを並列実行するため、`dashboard.test.ts` の記事数カウントがそのタイミングと衝突するとズレる。テスト隔離の問題(ファイル単位の並列実行 + 同一の実DBを共有しているのが根本原因)で、今回のスコープでは見送り。対応案: `commissions.test.ts` 側で一時記事を別ユーザー(hana 以外)名義にする、または vitest 側でこの2ファイルを直列化する。

- [ ] プロバイダーの「主要サービス」情報(`profiles.service_name`/`service_description`/`service_url`/`service_image_url`)と認定フラグ(`profiles.certified`)が、CMSで編集・admin管理はできるが公開サイト側にまだ一切表示されていない。認定済みプロバイダーのみサービス情報を公開する、というのが本来の狙い(`ARCHITECTURE.md` 参照)。対象になりそうな箇所: 公開サイトのプロバイダー用ページ(未作成)、または `src/pages/articles/[slug].astro:30` の「提供: {name}」表示の拡張。認定事業者バッジの公開サイト表示もこのタイミングで検討。

- [ ] 記事編集画面にネイティブダイアログ(`window.prompt`/`window.confirm`)がまだ残っている — 削除確認は `ConfirmDialog` に移行済みだが、(1) 審査理由の入力 `admin/src/pages/articles/edit.astro:214`、(2) 埋め込みURLの入力(同ファイルの embed コマンド)、(3) 下書きバックアップ復元の確認(同 `:235` 付近)、(4) インタビューブロック削除の確認(`admin/src/lib/interview-nodeview.ts` 側)がネイティブのまま。入力を伴う (1)(2) は `ConfirmDialog` にテキスト入力欄を足した派生コンポーネントが必要。

- [ ] インタビュー・ブロックの発言テキストが `<p>` で包まれず、`src/styles/global.css` の `.article-body .interview-block .turn p` バブル背景ルールが効かない。`Turn.content` を `'paragraph+'` に変えるか、`packages/blocks-renderer/src/render.ts` の `injectInterviewSpeakers` で turn 内テキストを `<p>` で包む対応が必要。関連: `packages/blocks-renderer/src/extensions.ts` の Turn ノード定義、`src/styles/global.css` の該当 CSS。

- [ ] **【要調査・データ破損】** ローカルDBの本物の記事5件すべての `body` が、同一のテスト用インタビューブロック内容(話者「米田」「川崎」、発言「プラスチックを拾ったきっかけは?…」)に上書きされている: `kaigan-seisou`・`kigyou-no-mori`・`kawabe-kansatsu`・`koke-no-mori`・`toshi-no-yachou`(2026-07-28、Chrome実機確認+DB直接クエリで確認)。決め手は `updated_at`: `kaigan-seisou`/`kigyou-no-mori`/`kawabe-kansatsu` の3件がミリ秒まで完全一致(`2026-07-26 07:20:30.343902`)しており、個別編集ではあり得ないため、インタビューブロック機能(`admin/src/pages/articles/edit.astro`・`admin/src/lib/interview-nodeview.ts`、当時未コミットで変更中だった)の保存処理に、複数記事へ同一ペイロードを書き込んでしまうバグがあった可能性が高い。`interview-e2e-test` 記事(2026-07-27作成)を使ったテスト中に発生したと推測されるが、リポジトリ内に該当する自動テスト/スクリプトは見当たらず、原因未特定。このため `tests/content.test.ts` の DB 依存テスト3件も失敗する。`supabase db reset` はローカルルールで禁止されているため未対応 — **他の並行作業が完全に終わったのを確認してから**、(1) 原因(保存処理のどこが複数記事に書き込んでいるか)を特定、(2) 安全なタイミングで `npm run seed` によるリセットを検討。目次カード機能(2026-07-28)の `extractHeadings` 関連ユニットテストはこの影響を受けず5件とも成功している。

- [ ] 未使用画像の週次自動掃除(pg_cron + Edge Function `cleanup-orphaned-media`、2026-07-28実装)の**本番セットアップ**が未実施 — 次回デプロイ時に `supabase functions deploy cleanup-orphaned-media` + Vault シークレット2件(`project_url` / `service_role_key`)の登録 + 動作確認。手順: `docs/superpowers/DEPLOYMENT-CHECKLIST.md` の Edge Functions 節。未セットアップの間、cron ジョブは毎週静かにスキップする(実害なし)。ローカルでの Edge Function 実機疎通(curl)も未実施(検出・削除ロジック自体は pgTAP `19_orphaned_media_cleanup.test.sql` で9件検証済み)。

- [ ] (環境起因、`02_rls` テスト11と同類)`supabase test db` で `18_announcements.test.sql` の4件(テスト6・9・13・14)が失敗する — seed 済みのお知らせ3件(`34bf9ae` で追加)がローカルDBに残っており、テストが期待する「クリーンな状態+挿入分だけ」という件数前提が崩れるため(2026-07-28、掃除機能のテスト実行時に確認。`19_orphaned_media_cleanup.test.sql` 自体は9件全パス)。DBリセット後は再現しないはず。

- [ ] `public.media` テーブルに `service_role` への GRANT がなく(`20260709120500_media_library.sql` は `authenticated` にのみ select/insert/delete を付与)、service role keyで `media` を読もうとすると `permission denied for table media` になる(2026-07-28、WP記事インポートスクリプトの動作確認中に気付いた。`authenticated` セッション経由では正常に読める)。ビルド時など service role でmediaを参照する処理は現状ないため実害はないが、今後そういう処理を足すなら要 GRANT 追加。

## Done

- [x] ライター側の依頼トークン入力欄(`admin/src/pages/articles/new.astro`・`edit.astro`)に説明ポップアップを追加 — 汎用の`InfoButton`(「?」アイコン)+`InfoDialog`(中央モーダル、`AdminLayout.astro`にグローバル配置)を新設し、`Field.astro`に`slot="info"`を追加してラベル横に配置。説明文は`admin/src/lib/editor-helpers.ts`の`COMMISSION_TOKEN_INFO_TITLE`/`_BODY`に集約(両ページで共有)。プロバイダー側の依頼UI(新規)はまだ存在しないため、そちらの説明表示は別途そのUIを作る際に対応(2026-07-29)。

- [x] 検索結果に検索語と無関係な記事が混ざる(関連度の足切りがない) — `20260724100200_search_articles_hybrid_threshold.sql` でベクトルCTEに `max_distance`(既定0.5)を導入して解消済み。ただしこの既定値0.5がキツすぎ、キーワードが本文と一致しない自然文クエリで本来ヒットすべき記事まで除外する偽陰性の副作用を確認(2026-07-28、Chrome実機確認+実embedding距離計測: 「森林保全の取り組み」と `企業の森づくり最前線` の距離0.5331が0.5をわずかに超過し除外→0件)。`20260728120000_search_articles_hybrid_relax_threshold.sql` で0.6へ緩和して修正・確認済み(pgTAPテスト・実edge function・ブラウザとも確認)。根本的には「距離の固定カットオフ」自体が seed のごく少数の記事構成に基づくヒューリスティックなので、記事数が増えたら再チューニングが要る可能性は残る。
- [x] **インタビュー・ブロックを自己完結にし、発言/ブロック単位の削除UIを追加** — (1) 中で `/` を押してもスラッシュメニューを発火させない(`admin/src/lib/insert-menu.ts` に `isInsideInterview` 述語を追加し `Suggestion.allow` で除外+`initInsertButton` の `＋` も interview 内では非表示)、(2) 各発言(turn)の右上に×ボタン(hover表示)、`turn--only` decoration + CSS で最後の 1 発言では隠す・実行時ガード付き、(3) 話者ツールバーに「ブロックを削除」ボタン(`window.confirm` 付き)。テスト 5 件追加(admin/tests/insert-menu.test.ts, admin/tests/interview-nodeview.test.ts)。E2Eで動作確認済み(2026-07-27)。

- [x] **ルートの `npm test` が `tests/life-sim.test.ts` の import で失敗する** — `src/lib/life-sim.ts` は既に削除済みだったのでテスト側も削除して整合。関連commit: (次のcommit)。

- [x] **インタビュー・ダイアログの「自分のプロフィール画像を使う」ボタンが、プロフィール画像URLが `settings.image_base_url` 配下でない場合にそのままセットしてしまう問題** — `admin/src/lib/interview-dialog.ts` に `imageBaseUrl` を渡し、`myProfile.avatarUrl.startsWith(imageBaseUrl)` でチェック。一致しない場合はボタンを `disabled` + `title` 属性で理由を表示、クリックハンドラでも二重チェック。`edit.astro`・`new.astro` ともに既存の `fetchImageBaseUrl` の結果を渡すよう修正。テスト 2 件追加(disable される / enable されて動作する)。E2Eで発見(2026-07-26)、同日修正。

- [x] **本番招待メール用に Resend SMTP を Supabase Auth に配線**。`vim@wyld-crd.org` で新規 Resend アカウント作成 → `send.wyld-crd.org` を Squarespace DNS(MX/SPF/DKIM/DMARC)で verify → API key を Supabase Dashboard → Authentication → SMTP Settings に投入(sender: `zine@send.wyld-crd.org`)。Supabase 側は "Successfully updated settings" で確定。実送信テストは別途 CMS から。関連: `supabase/functions/invite-user/index.ts:61`、認証情報は `PRODUCTION-SECRETS.local.md` の Resend セクション。

- [x] 検索機能で記事が返ってこない(以前は動いていた) — 原因: コード側(RPC・`profiles` inner join・Edge Function・`OPENAI_API_KEY`)はすべて正常、`public.post_chunks` が空なのが真因(`scripts/seed.mjs` が記事投入後に検索インデックスを作っていなかった)。修正: `scripts/seed.mjs` が記事投入後、CMSと同じコードパス(Edge Function `chunk-article`、admin としてサインインしたJWTで呼び出し)で `post_chunks` を構築するよう変更。Edge Functions未起動時は明確なエラーで失敗するようにした。`README.md`/`CLAUDE.md` のセットアップ手順も更新済み(`npm run seed` 前に `npm run dev:fn` が必要になった旨)。検証: seed後 `post_chunks` 0→5件、`search-articles` 呼び出しで実際に検索結果が返ることを確認、再実行しても重複しないことを確認(idempotent)。関連: `triggerChunking()` の失敗握りつぶし・バックフィル不在は別問題として上記 Open に起票。
