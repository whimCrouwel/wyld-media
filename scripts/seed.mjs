import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const url = process.env.PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY を .env に設定してください');
  process.exit(1);
}
const db = createClient(url, serviceKey, { auth: { persistSession: false } });

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString();

const USERS = [
  { email: 'admin@seed.local', role: 'admin', slug: 'seed-admin', name: '運営 太郎', bio: '' },
  { email: 'hana@seed.local', role: 'writer', slug: 'tanaka-hana', name: '田中 花', bio: '川と森を歩いて書くネイチャーライター。',
    avatar: 'https://picsum.photos/seed/tanaka-hana/400/400', cover: 'https://picsum.photos/seed/tanaka-hana-cover/1600/500', region: '甲信越', location: '長野県松本市',
    homepage: 'https://tanaka-hana.example', sns: ['https://x.example/tanakahana', 'https://instagram.example/tanakahana'],
    contact: 'https://forms.example/tanaka-hana',
    pricing: [
      { label: '基本記事(1,500〜2,000字)', unit: '1本', amount: 30000, published: true },
      { label: '現地取材同行', unit: '1日', amount: 25000, published: true },
      { label: '写真追加', unit: '1枚', amount: 3000, published: true },
      { label: '長文特集(4,000字〜)', unit: '1本', amount: 60000, published: false },
    ] },
  { email: 'kenta@seed.local', role: 'writer', slug: 'sato-kenta', name: '佐藤 健太', bio: '都市の生きものを追いかけています。',
    avatar: 'https://picsum.photos/seed/sato-kenta/400/400', cover: 'https://picsum.photos/seed/sato-kenta-cover/1600/500', region: '関東', location: '東京都杉並区',
    sns: ['https://x.example/satokenta'],
    pricing: [
      { label: '観察レポート', unit: '1本', amount: 20000, published: true },
    ] },
  { email: 'forest@seed.local', role: 'provider', slug: 'forest-org', name: 'フォレスト再生機構', bio: '企業と森をつなぐNPO。' },
  // 認定済みプロバイダーの動作確認用(forest-org は未認定のまま残す)。
  { email: 'certified@seed.local', role: 'provider', slug: 'certified-partners', name: '認定パートナーズ株式会社',
    bio: '森林保全と地域再生を手がける認定事業者。', certified: true,
    serviceName: '森林再生パートナーシップ', serviceDescription: '企業の森林保全活動を一気通貫で支援します。',
    serviceUrl: 'https://certified-partners.example', serviceImage: 'https://picsum.photos/seed/certified-partners/800/800' },
];

// 通常記事は同一著者で10日以上間隔を空け、古い順に insert する(頻度制限トリガー対策)。
// published_at の明示指定は service role(trusted)だから通る。
// kawabe-kansatsu の本文にはサニタイズ検証用の <script> を意図的に含めている。
const ARTICLES = [
  { author: 'tanaka-hana', slug: 'kawabe-kansatsu', title: '川辺の観察日記', publishedAt: daysAgo(30),
    region: '甲信越', body: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '川辺にて' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '朝の川辺を歩いた。' }] },
      { type: 'bulletList', content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'カワセミ' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'サギ' }] }] },
      ] },
      { type: 'paragraph', content: [{ type: 'text', text: '<script>alert("xss")</script>' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '静かな時間だった。', marks: [{ type: 'bold' }] }] },
    ] },
  { author: 'tanaka-hana', slug: 'koke-no-mori', title: '苔の森を歩く', publishedAt: daysAgo(15),
    region: '甲信越', body: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '苔の森' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '雨上がりの森は苔が輝く。' }] },
    ] },
  { author: 'sato-kenta', slug: 'toshi-no-yachou', title: '都市の野鳥観察', publishedAt: daysAgo(5),
    region: '関東', cover: 'https://placehold.co/1600x900', body: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '街の鳥たち' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '公園のカラスを観察した。' }] },
    ] },
  { author: 'tanaka-hana', slug: 'kigyou-no-mori', title: '企業の森づくり最前線', publishedAt: daysAgo(3),
    region: '関東', commissioned: true, body: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '企業の森' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'フォレスト再生機構の活動を取材した。' }] },
    ] },
  { author: 'tanaka-hana', slug: 'kaigan-seisou', title: '海岸清掃の一日', publishedAt: daysAgo(1),
    region: '九州', commissioned: true, body: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '海岸にて' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '清掃活動に参加した。' }] },
    ] },
];

async function main() {
  // 1) auth ユーザーを冪等に確保し、profiles を upsert
  const { data: listed, error: listError } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw listError;
  const byEmail = new Map(listed.users.map((u) => [u.email, u.id]));

  const ids = {};
  for (const u of USERS) {
    let id = byEmail.get(u.email);
    if (!id) {
      const { data, error } = await db.auth.admin.createUser({
        email: u.email,
        password: 'seed-pass-1234',
        email_confirm: true,
      });
      if (error) throw new Error(`createUser ${u.email}: ${error.message}`);
      id = data.user.id;
    }
    const { error: upsertError } = await db
      .from('profiles')
      .upsert(
        { id, role: u.role, slug: u.slug, name: u.name, bio: u.bio,
          avatar_url: u.avatar ?? null, cover_image_url: u.cover ?? null, region: u.region ?? null, location: u.location ?? null,
          homepage_url: u.homepage ?? null, sns_links: u.sns ?? [],
          contact_url: u.contact ?? null,
          // certified はここでは新規作成(insert)時にしか効かない: protect_profile_columns
          // トリガーが admin 以外(service role含む)による既存行への変更を拒否するため、
          // 既に存在するユーザーの認定状態を切り替えたい場合は admin が /users で行う。
          certified: u.certified ?? false,
          service_name: u.serviceName ?? null, service_description: u.serviceDescription ?? null,
          service_url: u.serviceUrl ?? null, service_image_url: u.serviceImage ?? null },
        { onConflict: 'id' },
      );
    if (upsertError) throw new Error(`profile ${u.slug}: ${upsertError.message}`);
    ids[u.slug] = id;
  }

  // 1b) 料金プラン(pricing_items)を冪等に seed。writer 全員分の既存行を消してから
  //    USERS 定義に沿って再挿入する(sort_order は配列順で10刻み)。
  const pricingWriterIds = USERS.filter((u) => u.pricing?.length).map((u) => ids[u.slug]);
  if (pricingWriterIds.length) {
    const { error: delPricingError } = await db
      .from('pricing_items')
      .delete()
      .in('writer_id', pricingWriterIds);
    if (delPricingError) throw delPricingError;
    const pricingRows = USERS.flatMap((u) => (u.pricing ?? []).map((p, idx) => ({
      writer_id: ids[u.slug],
      label: p.label,
      unit: p.unit,
      amount: p.amount,
      published: p.published,
      sort_order: (idx + 1) * 10,
    })));
    if (pricingRows.length) {
      const { error: pricingInsertError } = await db.from('pricing_items').insert(pricingRows);
      if (pricingInsertError) throw pricingInsertError;
    }
  }

  // 2) シード著者の記事を全削除してから入れ直す(冪等)。依頼トークンの再発行より先に
  //    削除する: 記事が commission_token_id を参照している間はそのトークンを削除できない。
  const authorIds = [ids['tanaka-hana'], ids['sato-kenta']];
  const { error: delError } = await db.from('articles').delete().in('author_id', authorIds);
  if (delError) throw delError;

  // 3) 依頼記事の数だけ、provider(forest-org)から著者(tanaka-hana)宛ての
  //    依頼トークンを発行する(1トークン=1記事、使い切り)。
  //    まず旧トークンを削除してから発行し直す(冪等。残したままだと再seed時に
  //    commission_interval_days の間隔チェックに引っかかることがある)。
  //    トークン発行は commission_tokens の RLS で provider_id = auth.uid() を要求するため、
  //    service role では作れない。forest@seed.local としてサインインして発行する。
  const { error: delTokensError } = await db
    .from('commission_tokens')
    .delete()
    .eq('provider_id', ids['forest-org'])
    .eq('writer_id', ids['tanaka-hana']);
  if (delTokensError) throw delTokensError;

  const anonKeyForTokens = process.env.PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKeyForTokens) {
    throw new Error('PUBLIC_SUPABASE_ANON_KEY を .env に設定してください(依頼トークン発行に必要)');
  }
  const providerClient = createClient(url, anonKeyForTokens, { auth: { persistSession: false } });
  const { error: providerSignInError } = await providerClient.auth.signInWithPassword({
    email: 'forest@seed.local', password: 'seed-pass-1234',
  });
  if (providerSignInError) {
    throw new Error(`依頼トークン発行用のサインインに失敗しました(forest@seed.local): ${providerSignInError.message}`);
  }
  const commissionedCount = ARTICLES.filter((a) => a.commissioned).length;
  const tokens = [];
  for (let i = 0; i < commissionedCount; i++) {
    // commission_interval_days(同一provider/writerへの依頼は最短10日おき)を満たすよう、
    // トークンごとに間隔を空けた過去日時で発行する。
    const { data, error } = await providerClient
      .from('commission_tokens')
      .insert({ writer_id: ids['tanaka-hana'], created_at: daysAgo(15 * (commissionedCount - i)) })
      .select('token')
      .single();
    if (error) throw new Error(`commission_tokens insert ${i}: ${error.message}`);
    tokens.push(data.token);
  }

  const insertedArticles = [];
  for (const a of ARTICLES) {
    const { data, error } = await db.from('articles').insert({
      author_id: ids[a.author],
      slug: a.slug,
      title: a.title,
      body: a.body,
      cover_image_url: a.cover ?? null,
      status: 'published',
      published_at: a.publishedAt,
      commission_token_input: a.commissioned ? tokens.shift() : null,
      region: a.region ?? null,
    }).select('id').single();
    if (error) throw new Error(`article ${a.slug}: ${error.message}`);
    insertedArticles.push({ slug: a.slug, id: data.id });
  }

  // 4) 公開ページに出てはいけない下書きを1本
  const { error: draftError } = await db.from('articles').insert({
    author_id: ids['tanaka-hana'],
    title: '下書きメモ',
    body: [{ type: 'paragraph', content: [{ type: 'text', text: 'まだ書きかけ。' }] }],
    status: 'draft',
  });
  if (draftError) throw draftError;

  // 4b) お知らせ。公開サイトのサイドバーバナー確認用に end_user 向け公開1件と、
  //     CMSサイドバーのお知らせ欄確認用に writer / provider 向け各1件を、固定IDで
  //     冪等に入れ直す(writer 向けは anon から見えないことの確認も兼ねる)。
  const SEED_ANNOUNCEMENTS = [
    { id: '00000000-0000-0000-0000-0000000000b1', title: 'Wild Media がリニューアルしました',
      body: '記事プラットフォーム Wild Media はデザインを一新しました。地域から記事を探せるサイドバーの地図ナビもぜひご活用ください。',
      audiences: ['end_user'], published: true },
    { id: '00000000-0000-0000-0000-0000000000b2', title: '【ライター向け】原稿料の改定について',
      body: '来月分の依頼から新しい料金テーブルが適用されます。詳細はCMSのお知らせをご確認ください。',
      audiences: ['writer'], published: true },
    { id: '00000000-0000-0000-0000-0000000000b3', title: '【事業者向け】依頼フローが新しくなりました',
      body: 'ライターへの依頼トークン発行画面を刷新しました。ダッシュボードからご確認ください。',
      audiences: ['provider'], published: true },
  ];
  const { error: delAnnError } = await db
    .from('announcements')
    .delete()
    .in('id', SEED_ANNOUNCEMENTS.map((a) => a.id));
  if (delAnnError) throw delAnnError;
  const { error: annError } = await db
    .from('announcements')
    .insert(SEED_ANNOUNCEMENTS.map((a) => ({ ...a, created_by: ids['seed-admin'] })));
  if (annError) throw annError;

  // 5) settings.image_base_url を設定する。これが画像公開ホストの唯一の権威で、
  //    Edge Function(r2-upload-url / r2-delete-object)と保存トリガーが揃ってこの
  //    DB 値を読む。ローカルでは PUBLIC_IMAGE_BASE_URL から流し込む。
  const imageBaseUrl = process.env.PUBLIC_IMAGE_BASE_URL;
  if (!imageBaseUrl) {
    throw new Error(
      'PUBLIC_IMAGE_BASE_URL を .env に設定してください(R2 の公開URLベース。settings.image_base_url に入る)',
    );
  }
  // page_size は本番既定値(12)だとシードの5記事ではページングが1枚に収まって見えない。
  // ローカル確認用に2へ下げる。
  const { error: settingsError } = await db
    .from('settings')
    .update({ image_base_url: imageBaseUrl, page_size: 2 })
    .eq('id', 1);
  if (settingsError) throw settingsError;

  // 6) 検索インデックス構築(post_chunks)。CMSが記事保存時に叩くのと同じ
  //    Edge Function(chunk-article)を、同じコードパスで呼ぶ(チャンク化ロジックを
  //    ここで再実装しない)。chunk-article は呼び出し元の実ユーザーJWTを見て
  //    著者本人 or admin かを判定するので、service role キーでは呼べない。
  //    シードadminでサインインしたJWTを使う(admin権限なので全記事に対して通る)。
  //    要:Edge Functions起動(`npm run dev:fn` / `npm run dev:all`)+
  //    `supabase/functions/.env` の OPENAI_API_KEY(embedding生成に必須)。
  const anonKey = process.env.PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) {
    throw new Error('PUBLIC_SUPABASE_ANON_KEY を .env に設定してください(chunk-article 呼び出しに必要)');
  }
  const authClient = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: signInError } = await authClient.auth.signInWithPassword({
    email: 'admin@seed.local', password: 'seed-pass-1234',
  });
  if (signInError) {
    throw new Error(`検索インデックス構築用のサインインに失敗しました(admin@seed.local): ${signInError.message}`);
  }

  console.log(`検索インデックスを構築中(chunk-article, ${insertedArticles.length}件)...`);
  for (const a of insertedArticles) {
    const { error } = await authClient.functions.invoke('chunk-article', {
      body: { articleId: a.id },
    });
    if (error) {
      console.error(
        '\nchunk-article の呼び出しに失敗しました。以下を確認してください:\n' +
        '  1. Edge Functions が起動しているか(`npm run dev:fn` または `npm run dev:all`)\n' +
        '  2. `supabase/functions/.env` に OPENAI_API_KEY が設定されているか\n',
      );
      throw new Error(`chunk-article ${a.slug}: ${error.message ?? error}`);
    }
  }

  console.log(
    `Seed complete: ${USERS.length} users, 5 published articles (2 commissioned, indexed for search), 1 draft, 3 announcements`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
