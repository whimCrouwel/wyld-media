// 旧WordPressサイト(../wp-export)の記事を、レガシーライター名義でSupabaseに
// 冪等インポートする。CMSが使うのと同じ経路(anon key + 通常ログインセッション)で
// 書き込むため、RLS・DBトリガーは一切バイパスしない。
//
// 使い方:
//   PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY を .env に設定した上で:
//   node scripts/import-wp-articles.mjs            # 実際にinsertする
//   DRY_RUN=1 node scripts/import-wp-articles.mjs   # 何もinsertせず、やる内容だけログ出力
//
// 冪等性:
//   - 記事は slug が既存なら丸ごとスキップする
//   - 画像は mediaテーブルに同じバイト数の既存レコードがあれば再アップロードせず使い回す
//
// 常に status:'draft' でinsertする。published_at には元記事の公開日を保持するので、
// 本番公開する際は「レガシーライター自身」ではなく「admin」が公開に切り替えること
// (enforce_publish_rules: 通常ライターが公開に切り替えるとpublished_atは強制的に
//  現在時刻に上書きされ、かつ同一著者の頻度制限[post_interval_days]に引っかかる。
//  admin/service role[trusted]が切り替える場合のみ、既存のpublished_atが保持され、
//  かつ頻度制限の比較対象は実時刻now()なので、過去日付のデータは制限に触れない)。

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const WP_EXPORT_DIR = process.env.WP_EXPORT_DIR
  ? path.resolve(process.env.WP_EXPORT_DIR)
  : path.resolve(REPO_ROOT, '..', '..', 'wp-export');

const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.PUBLIC_SUPABASE_ANON_KEY;
const WRITER_EMAIL = process.env.WP_IMPORT_WRITER_EMAIL || 'legacy@seed.local';
const WRITER_PASSWORD = process.env.WP_IMPORT_WRITER_PASSWORD || 'seed-pass-1234';
const DRY_RUN = process.env.DRY_RUN === '1';

if (!SUPABASE_URL || !ANON_KEY) {
  console.error('PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY を .env に設定してください');
  process.exit(1);
}

// 日本語版のみ(英語ペアは除外)。slugはDB制約(^[a-z0-9]+(-[a-z0-9]+)*$)に合わせて
// 手動で採番(元のfrontmatter slugは日本語のため使えない)。
const TARGET_ARTICLES = [
  { file: '2025-10-30-kanazawa-sdgsフェスタ-まちなかの生き物-ツアー参加レ.md', slug: 'kanazawa-sdgs-festa-machinaka-tour' },
  { file: '2025-11-05-外来種の除去で白山の生態系を守る.md', slug: 'hakusan-invasive-species-removal' },
  { file: '2025-11-05-海洋プラスチックを綺麗なマーブル模様のアクセ.md', slug: 'kaeru-design-marine-plastic-accessory' },
  { file: '2025-11-07-石川環境フェア2025.md', slug: 'ishikawa-kankyo-fair-2025' },
  { file: '2025-11-18-廃棄される家具を現代的に再構築-toton.md', slug: 'toton-upcycled-furniture' },
  { file: '2025-12-04-プラスチックゴミはなぜ多い.md', slug: 'where-does-plastic-waste-go' },
  { file: '2026-01-30-ryuichi-sakamoto-more-trees.md', slug: 'ryuichi-sakamoto-more-trees' },
  { file: '2026-02-03-森と生きるチョコレート.md', slug: 'chocolate-that-lives-with-forest' },
  { file: '2026-03-24-surfing-and-farming.md', slug: 'surfing-and-farming' },
  { file: '2026-03-30-石川の海を守るアクセサリー作家-川崎さんの挑.md', slug: 'kawasaki-marine-plastic-accessory-workshop' },
  { file: '2026-05-13-satoyama-preservation.md', slug: 'satoyama-preservation' },
  { file: '2026-05-30-はじめてのビーチクリーン.md', slug: 'first-beach-cleanup-senkoji' },
];

const CONTENT_TYPE_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

// ---------- frontmatter ----------
function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const mm = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!mm) continue;
    let val = mm[2].trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    meta[mm[1]] = val;
  }
  return { meta, body: m[2] };
}

// ---------- インライン記法 -> Tiptap text nodes ----------
function parseInline(text) {
  const nodes = [];
  const push = (t, marks) => {
    if (!t) return;
    nodes.push(marks && marks.length ? { type: 'text', text: t, marks } : { type: 'text', text: t });
  };
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let match;
  while ((match = re.exec(text))) {
    if (match.index > last) push(text.slice(last, match.index), null);
    if (match[1] !== undefined) push(match[1], [{ type: 'bold' }]);
    else if (match[2] !== undefined) push(match[2], [{ type: 'italic' }]);
    else if (match[3] !== undefined) push(match[3], [{ type: 'link', attrs: { href: match[4] } }]);
    last = re.lastIndex;
  }
  if (last < text.length) push(text.slice(last), null);
  return nodes;
}

// ---------- Markdown本文 -> Tiptapブロック配列 ----------
// 見出し(##/###)・段落・画像・Q&A(interviewブロック)を扱う。
// interviewブロックは開始したら、見出し/画像/EOFに達するまで以降の行を
// 全部飲み込む(Q:/A:行は新しいturn、それ以外は直前turnへの継続行として扱う)。
// これにより「原文の空行がturn内の段落区切りなのか、interviewの終わりなのか」
// という曖昧さがあっても、Q&Aの内容を取りこぼすことだけは絶対にない設計にしている
// (多少インタビュー末尾に地の文が混ざることはあるが、下書きとして人間が確認するので実害はない)。
function mdBodyToBlocks(bodyText, imageUrlByFilename) {
  const lines = bodyText.split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (lines[i] !== undefined && /^#\s+/.test(lines[i].trim())) i++;

  let paragraphBuf = [];
  let currentInterview = null;
  let pendingSpeakerName = null;

  const flushParagraph = () => {
    if (!paragraphBuf.length) return;
    const text = paragraphBuf.join(' ').trim();
    paragraphBuf = [];
    if (!text) return;
    const boldOnly = text.match(/^\*\*(.+?)\*\*\s*(?:\(.*\))?$/);
    if (boldOnly && !currentInterview) pendingSpeakerName = boldOnly[1];
    const content = parseInline(text);
    if (content.length) blocks.push({ type: 'paragraph', content });
  };

  for (; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line === '') {
      flushParagraph();
      continue;
    }

    const heading3 = line.match(/^###\s+(.*)$/);
    const heading2 = line.match(/^##\s+(.*)$/);
    const image = line.match(/^!\[([^\]]*)\]\(\.\.\/images\/([^)]+)\)$/);
    const qLine = line.match(/^\*\*Q:\*\*\s*(.*)$/);
    const aLine = line.match(/^\*\*A:\*\*\s*(.*)$/);

    if (heading3 || heading2 || image) {
      flushParagraph();
      currentInterview = null; // 見出し・画像でinterviewを終了
    }

    if (heading3) { blocks.push({ type: 'heading', attrs: { level: 3 }, content: parseInline(heading3[1]) }); continue; }
    if (heading2) { blocks.push({ type: 'heading', attrs: { level: 2 }, content: parseInline(heading2[1]) }); continue; }
    if (image) {
      const [, alt, filename] = image;
      const url = imageUrlByFilename.get(decodeURIComponent(filename));
      if (url) blocks.push({ type: 'image', attrs: { url, caption: null, alt: alt || '' } });
      continue;
    }

    if (qLine || aLine) {
      flushParagraph();
      if (!currentInterview) {
        currentInterview = {
          type: 'interview',
          attrs: { speakers: [{ key: 'A', name: '聞き手' }, { key: 'B', name: pendingSpeakerName || 'ゲスト' }] },
          content: [],
        };
      }
      const speakerKey = qLine ? 'A' : 'B';
      const textPart = (qLine ? qLine[1] : aLine[1]).trim();
      // turn は paragraph+ (2026-08-07修正)。text を直接ではなく paragraph に包んで積む。
      currentInterview.content.push({
        type: 'turn',
        attrs: { speaker: speakerKey },
        content: [{ type: 'paragraph', content: parseInline(textPart) }],
      });
      continue;
    }

    if (currentInterview) {
      const lastTurn = currentInterview.content[currentInterview.content.length - 1];
      if (lastTurn) {
        const lastParagraph = lastTurn.content[lastTurn.content.length - 1];
        lastParagraph.content.push({ type: 'text', text: ' ' });
        lastParagraph.content.push(...parseInline(line));
      }
      continue;
    }

    paragraphBuf.push(line);
  }
  flushParagraph();
  if (currentInterview) blocks.push(currentInterview);
  blocks.push({ type: 'paragraph', content: [] });

  return blocks;
}

// ---------- 記事本文が参照する画像ファイル名を集める ----------
function collectImageFilenames(bodyText) {
  const names = new Set();
  const re = /!\[[^\]]*\]\(\.\.\/images\/([^)]+)\)/g;
  let m;
  while ((m = re.exec(bodyText))) names.add(decodeURIComponent(m[1]));
  return names;
}

async function main() {
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

  const { data: signInData, error: signInError } = await db.auth.signInWithPassword({
    email: WRITER_EMAIL,
    password: WRITER_PASSWORD,
  });
  if (signInError) throw new Error(`ログイン失敗(${WRITER_EMAIL}): ${signInError.message}`);
  const writerId = signInData.user.id;
  const accessToken = signInData.session.access_token;
  console.log(`ログイン成功: ${WRITER_EMAIL} (${writerId})${DRY_RUN ? ' [DRY_RUN]' : ''}`);

  async function uploadOrReuseImage(filePath) {
    const buf = fs.readFileSync(filePath);
    const bytes = buf.length;
    const ext = path.extname(filePath).toLowerCase();
    const contentType = CONTENT_TYPE_BY_EXT[ext];
    if (!contentType) throw new Error(`未対応の拡張子: ${filePath}`);

    const { data: existing, error: existingErr } = await db
      .from('media')
      .select('url')
      .eq('owner_id', writerId)
      .eq('bytes', bytes)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (existing) return { url: existing.url, reused: true };

    if (DRY_RUN) return { url: `dry-run://${path.basename(filePath)}`, reused: false };

    const signRes = await fetch(`${SUPABASE_URL}/functions/v1/r2-upload-url`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType, contentLength: bytes, kind: 'image' }),
    });
    if (!signRes.ok) throw new Error(`r2-upload-url失敗(${filePath}): ${signRes.status} ${await signRes.text()}`);
    const { uploadUrl, publicUrl } = await signRes.json();

    const putRes = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: buf });
    if (!putRes.ok) throw new Error(`R2アップロード失敗(${filePath}): ${putRes.status}`);

    const { error: insErr } = await db.from('media').insert({ owner_id: writerId, url: publicUrl, bytes });
    if (insErr) throw insErr;
    return { url: publicUrl, reused: false };
  }

  const summary = { imported: 0, skipped: 0, failed: 0 };

  for (const target of TARGET_ARTICLES) {
    const filePath = path.join(WP_EXPORT_DIR, 'articles', target.file);
    const raw = fs.readFileSync(filePath, 'utf-8');
    const { meta, body } = parseFrontmatter(raw);

    const { data: existingArticle, error: existingArticleErr } = await db
      .from('articles')
      .select('id')
      .eq('slug', target.slug)
      .maybeSingle();
    if (existingArticleErr) throw existingArticleErr;
    if (existingArticle) {
      console.log(`スキップ(既存): ${target.slug}`);
      summary.skipped++;
      continue;
    }

    const imageFilenames = collectImageFilenames(body);
    const imageUrlByFilename = new Map();
    for (const filename of imageFilenames) {
      const imgPath = path.join(WP_EXPORT_DIR, 'images', filename);
      if (!fs.existsSync(imgPath)) {
        console.warn(`  画像が見つかりません、スキップ: ${filename}`);
        continue;
      }
      const { url, reused } = await uploadOrReuseImage(imgPath);
      imageUrlByFilename.set(filename, url);
      console.log(`  画像${reused ? '再利用' : 'アップロード'}: ${filename}`);
    }

    const blocks = mdBodyToBlocks(body, imageUrlByFilename);
    const publishedAt = meta.date ? new Date(`${meta.date}T09:00:00+09:00`).toISOString() : null;

    const articleRow = {
      author_id: writerId,
      slug: target.slug,
      title: meta.title || target.slug,
      body: blocks,
      status: 'draft',
      published_at: publishedAt,
    };

    if (DRY_RUN) {
      console.log(`[DRY_RUN] insert予定: ${target.slug} (title="${articleRow.title}", 画像${imageUrlByFilename.size}枚, blocks=${blocks.length})`);
      summary.imported++;
      continue;
    }

    const { error: insertErr } = await db.from('articles').insert(articleRow);
    if (insertErr) {
      console.error(`失敗: ${target.slug}: ${insertErr.message}`);
      summary.failed++;
      continue;
    }
    console.log(`インポート成功: ${target.slug}`);
    summary.imported++;
  }

  console.log(`\n完了: 成功${summary.imported}件 / スキップ${summary.skipped}件 / 失敗${summary.failed}件`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
