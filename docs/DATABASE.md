# データベース構造

Wild Media の Postgres スキーマ(`public`)の ER 図。信頼境界・RLS の詳細は [ARCHITECTURE.md](../ARCHITECTURE.md) を参照。マイグレーションの実体は `supabase/migrations/`。

```mermaid
erDiagram
    "auth.users" ||--o| profiles : "id (1:1)"
    "auth.users" ||--o{ media : "owner_id"
    profiles ||--o{ articles : "author_id"
    profiles ||--o{ pricing_items : "writer_id"
    profiles ||--o{ commission_tokens : "provider_id"
    profiles ||--o{ commission_tokens : "writer_id"
    commission_tokens |o--o| articles : "commission_token_id (nullable, unique)"
    profiles |o--o{ articles : "commissioned_by (nullable)"
    profiles |o--o{ articles : "moderation_hold_by (nullable)"
    articles ||--o{ post_chunks : "article_id (cascade delete)"
    profiles |o--o{ announcements : "created_by (nullable)"

    "auth.users" {
        uuid id PK
        text email
    }

    profiles {
        uuid id PK "FK -> auth.users.id, cascade delete"
        user_role role "admin / writer / provider"
        text slug UK
        text name
        text bio
        text avatar_url "顔写真(サムネイル)"
        text cover_image_url "プロフィール上部のバナー"
        text region "活動拠点エリア(12区分、check制約)"
        text location "活動拠点の詳細(自由記述)"
        text homepage_url
        jsonb sns_links
        text contact_url
        text service_name "プロバイダーの主要サービス名(1社1件)"
        text service_description
        text service_url
        text service_image_url
        boolean certified "認定プロバイダーか(admin以外は変更不可)"
        timestamptz created_at
    }

    articles {
        uuid id PK
        uuid author_id FK "-> profiles.id, cascade delete"
        text slug UK "公開時のみ必須"
        text title
        jsonb body "Tiptapブロック配列"
        text description "nullable、SEO用の要約。nullなら本文からの抜粋にフォールバック"
        text cover_image_url
        text region "取材地(12区分、公開時必須)"
        article_status status "draft / published"
        timestamptz published_at "公開時のみ必須"
        text commission_token_input "入力値、トリガーがcommissioned_by/commission_token_idへ解決"
        uuid commission_token_id FK "-> commission_tokens.id, nullable, unique"
        uuid commissioned_by FK "-> profiles.id, nullable"
        boolean moderation_hold "adminのみ変更可(トリガー)。trueの間は公開サイトに出ない"
        timestamptz moderation_hold_at "nullable、admin操作時にサーバー側で自動設定"
        uuid moderation_hold_by FK "-> profiles.id, nullable、admin操作時にサーバー側で自動設定"
        text moderation_hold_reason "nullable、ホールド設置時必須(トリガー)。ライターにも表示される"
        timestamptz created_at
        timestamptz updated_at
    }

    commission_tokens {
        uuid id PK
        uuid provider_id FK "-> profiles.id"
        uuid writer_id FK "-> profiles.id"
        text token UK "WM-XXXXXXXX形式"
        timestamptz created_at
        timestamptz revoked_at "nullable"
        uuid revoked_by FK "-> profiles.id, nullable"
    }

    settings {
        int id PK "常に1行のみ(id=1)"
        int post_interval_days "通常記事の投稿間隔(日)"
        int commission_interval_days "同一provider→writerへの依頼間隔(日)"
        int featured_count "Featured枠の件数"
        int page_size "一覧1ページあたりの記事数"
        text image_base_url "本文画像の許可ホスト(fail closed)"
    }

    pricing_items {
        uuid id PK
        uuid writer_id FK "-> profiles.id, cascade delete"
        text label "項目名(空文字禁止)"
        text unit "単位(「1本」「1日」など、空文字可)"
        int amount "単価(円、0以上)"
        text currency "JPY 固定(将来余地)"
        int sort_order "並び順(小さい順に上から表示)"
        boolean published "公開中か下書きか"
        timestamptz created_at
        timestamptz updated_at
    }

    media {
        uuid id PK
        uuid owner_id FK "-> auth.users.id, cascade delete"
        text url UK
        int bytes
        timestamptz created_at
    }

    announcements {
        uuid id PK
        text title
        text body
        text_array audiences "writer/provider/end_user の組み合わせ、空不可"
        boolean published
        uuid created_by FK "-> profiles.id, nullable"
        timestamptz created_at
        timestamptz updated_at
    }

    post_chunks {
        uuid id PK
        uuid article_id FK "-> articles.id, cascade delete"
        int chunk_index "article_id+chunk_indexで一意"
        text heading_path "見出しラベル(検索結果表示用)"
        text content "チャンク本文(embedding元・全文検索対象)"
        int token_count
        vector_1536 embedding "pgvector, nullable"
        timestamptz created_at
        timestamptz updated_at
    }
```

## テーブルごとの補足

| テーブル | アクセス範囲 | 備考 |
|---|---|---|
| `profiles` | RLS: 本人 or admin(select/update)。writer は全認証ユーザーに公開(select、依頼先選択用) | `role`(admin/writer/provider)。`certified` は admin のみ変更可(トリガー) |
| `articles` | RLS: select/update/delete は著者 or admin。insert は著者(=自分)かつ writer roleのみ(admin・providerは記事を作成できない) | `body` は Tiptap ブロックJSON(`jsonb`)。公開条件・投稿間隔・画像/埋め込みルールはすべて DB トリガーで強制(`enforce_publish_rules`・`enforce_body_image_rules`・`enforce_body_embed_rules` など)。`moderation_hold` はadmin専用の審査ホールドで、`status`とは独立に公開サイト・検索での可視性を上書きする(`protect_moderation_hold_columns`) |
| `settings` | RLS: authenticated 全員read、admin write | シングルトン(`id=1`固定)。`image_base_url` は空文字が既定(fail closed) |
| `pricing_items` | RLS: writer 本人 or admin(select/insert/update/delete)。CMS内で他人の料金は見えない | ライターの公開プロフィール(`/writers/[slug]`)に載せる料金プラン。`published=true` の行を `sort_order` 昇順で表示。公開サイトのビルドは service role で読むので RLS はバイパスされる |
| `media` | RLS: 所有者 or admin | R2にアップロード済み画像のURL記録のみ。記事から参照中の画像は削除不可(`block_media_in_use`) |
| `announcements` | RLS: admin は全件CRUD。writer/providerはpublished=trueかつ自分のaudienceのみselect。anonはpublished=trueかつend_user向けのみselect | 公開サイトが初めてブラウザから直接(anon key + RLS)読むテーブル。他の公開データはビルド時にservice roleで読む |
| `post_chunks` | RLS: ポリシーなし(service role専用) | ハイブリッド検索用。`embedding`(pgvector, 1536次元)+ `content`(pgroonga全文検索対象)。anon/authenticatedからは直接アクセス不可、`chunk-article`/`search-articles` Edge Function経由のみ |

## 主なDB関数(トリガー・RPC)

| 関数 | 種別 | 役割 |
|---|---|---|
| `is_admin()` | トリガー内で使用 | 呼び出しユーザーがadmin roleかを判定 |
| `is_writer()` | RLSポリシー内で使用 | 呼び出しユーザーがwriter roleかを判定(`articles` insert の制限に使用) |
| `is_provider()` | RLSポリシー内で使用 | 呼び出しユーザーがprovider roleかを判定(`announcements` select の対象出し分けに使用) |
| `set_commission_token()` | トリガー | `commission_tokens` insert時、provider_idを呼び出し本人に強制し、トークンを自動採番 |
| `guard_commission_token_revoke()` | トリガー | `revoked_at` の null→非null 変更のみ許可し、使用済みトークンの取消を拒否 |
| `validate_commission_token(token, article_id)` | RPC | 依頼トークンの実在チェック(呼び出し本人宛て・未取消・未使用〈article_idは自分自身を除外〉のみ応答) |
| `resolve_commission_token()` | トリガー | 記事保存時、`commission_token_input` から `commissioned_by`/`commission_token_id` を解決 |
| `enforce_publish_rules()` | トリガー | 公開条件(投稿間隔・本文必須など)を強制 |
| `enforce_body_image_rules()` | トリガー | 本文中の画像枚数・ホスト許可を強制 |
| `enforce_body_embed_rules()` | トリガー | 本文中の埋め込み(YouTube/Vimeo/X)ホスト許可を強制 |
| `block_media_in_use()` | トリガー | 記事から参照中の `media` 行の削除を禁止 |
| `protect_moderation_hold_columns()` | トリガー | `moderation_hold`/`_at`/`_by` の変更をadminのみに制限し、変更時に `_at`/`_by` をサーバー側で自動設定・自動クリアする |
| `search_articles_hybrid(query_embedding, query_text, match_count, max_distance)` | RPC(service role専用) | pgvector類似検索 + pgroonga全文検索をRRFでマージし、`articles.status='published' and not moderation_hold` をDB層で強制した上で上位記事を返す。ベクトル側は cosine distance が `max_distance`(既定0.5)以下のチャンクのみ候補にして、無関係な記事が kNN の下位に紛れ込まないようにする |
