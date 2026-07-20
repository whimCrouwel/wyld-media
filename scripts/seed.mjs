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
    price: '記事1本 3万円〜', contact: 'https://forms.example/tanaka-hana' },
  { email: 'kenta@seed.local', role: 'writer', slug: 'sato-kenta', name: '佐藤 健太', bio: '都市の生きものを追いかけています。',
    avatar: 'https://picsum.photos/seed/sato-kenta/400/400', cover: 'https://picsum.photos/seed/sato-kenta-cover/1600/500', region: '関東', location: '東京都杉並区',
    sns: ['https://x.example/satokenta'], price: '応相談' },
  { email: 'forest@seed.local', role: 'provider', slug: 'forest-org', name: 'フォレスト再生機構', bio: '企業と森をつなぐNPO。' },
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
          price_info: u.price ?? null, contact_url: u.contact ?? null },
        { onConflict: 'id' },
      );
    if (upsertError) throw new Error(`profile ${u.slug}: ${upsertError.message}`);
    ids[u.slug] = id;
  }

  // 2) provider の依頼コード(insert 時に自動生成済み)を取得
  const { data: provider, error: providerError } = await db
    .from('profiles').select('commission_code').eq('slug', 'forest-org').single();
  if (providerError) throw providerError;
  const code = provider.commission_code;

  // 3) シード著者の記事を全削除してから入れ直す(冪等)
  const authorIds = [ids['tanaka-hana'], ids['sato-kenta']];
  const { error: delError } = await db.from('articles').delete().in('author_id', authorIds);
  if (delError) throw delError;

  for (const a of ARTICLES) {
    const { error } = await db.from('articles').insert({
      author_id: ids[a.author],
      slug: a.slug,
      title: a.title,
      body: a.body,
      cover_image_url: a.cover ?? null,
      status: 'published',
      published_at: a.publishedAt,
      commission_code_input: a.commissioned ? code : null,
      region: a.region ?? null,
    });
    if (error) throw new Error(`article ${a.slug}: ${error.message}`);
  }

  // 4) 公開ページに出てはいけない下書きを1本
  const { error: draftError } = await db.from('articles').insert({
    author_id: ids['tanaka-hana'],
    title: '下書きメモ',
    body: [{ type: 'paragraph', content: [{ type: 'text', text: 'まだ書きかけ。' }] }],
    status: 'draft',
  });
  if (draftError) throw draftError;

  // 5) settings.image_base_url を設定する。これが画像公開ホストの唯一の権威で、
  //    Edge Function(r2-upload-url / r2-delete-object)と保存トリガーが揃ってこの
  //    DB 値を読む。ローカルでは PUBLIC_IMAGE_BASE_URL から流し込む。
  const imageBaseUrl = process.env.PUBLIC_IMAGE_BASE_URL;
  if (!imageBaseUrl) {
    throw new Error(
      'PUBLIC_IMAGE_BASE_URL を .env に設定してください(R2 の公開URLベース。settings.image_base_url に入る)',
    );
  }
  const { error: settingsError } = await db
    .from('settings')
    .update({ image_base_url: imageBaseUrl })
    .eq('id', 1);
  if (settingsError) throw settingsError;

  console.log('Seed complete: 4 users, 5 published articles (2 commissioned), 1 draft');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
