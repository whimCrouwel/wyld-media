const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const COMMISSION_TOKEN_INFO_TITLE = '依頼トークンとは';
export const COMMISSION_TOKEN_INFO_BODY = `依頼トークンは、プロバイダー(広告主)があなた宛てに発行する、1回限りの合言葉です(例: WM-1A2B3C4D)。

サイトの外で依頼を受けたら、プロバイダーからトークンを受け取ってこの欄に入力してください。カーソルを外すと依頼者名が表示され、正しいトークンか確認できます。保存すると記事が依頼元に紐づき、投稿間隔の制限なしで公開でき、トップページの特集(Featured)枠に掲載されます。

1つのトークンは1つの記事にのみ使えます。心当たりのある依頼がなければ、空欄のままで構いません。

報酬の支払いなどの取引はすべて両者間で直接行い、運営は一切関与しません。依頼を受ける前に「依頼の仕組み」ページの重要な注意を必ずお読みください。`;
export const COMMISSION_TOKEN_INFO_LINK = {
  href: '/commission-guide',
  label: '「依頼の仕組み」と重要な注意を読む →',
};

export const EDITOR_HELP_INFO_TITLE = '編集画面の使い方';
export const EDITOR_HELP_INFO_BODY = `本文欄で「/」を入力すると、見出し・箇条書き・引用・区切り線・画像・ファイル添付・埋め込み(YouTube/X/Vimeo)・インタビュー(会話)・目次といったブロックをその場で挿入できます。

テキストを選択すると、選択範囲の上に太字・見出し・リンクなどを設定できるツールバーが表示されます。

画像は「/」から「画像を挿入」を選ぶと新しくアップロードでき、「メディアから選ぶ」を選ぶと過去にアップロードした画像を再利用できます。`;

export function isValidArticleSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

// タイトルから URL 用スラッグを作る。英数字を含むタイトルはそこから、
// 日本語だけのタイトルは英数字が残らないので空文字を返す(呼び出し側で
// フォールバックする)。返り値は空文字か、必ず isValidArticleSlug を満たす形。
export function slugifyTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // ラテン文字のアクセントを除去
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // 英数字以外(日本語・記号・空白)はハイフンに
    .replace(/-{2,}/g, '-') // 連続ハイフンを1つに
    .replace(/^-+|-+$/g, ''); // 先頭・末尾のハイフンを除去
}

// タイトルから公開可能なスラッグを必ず1つ返す。英数字が拾えない
// (日本語のみ等)ときは、公開が詰まらないよう読めるフォールバックIDを返す。
// これで「スラッグが必要です」でライターが止まることをなくす。
export function generateArticleSlug(title: string): string {
  const base = slugifyTitle(title);
  if (base) return base;
  return `kiji-${Date.now().toString(36)}`;
}

export function translateSaveError(err: unknown): string {
  const e = err as { message?: string; code?: string } | null;
  const msg = e?.message ?? '';
  if (msg.includes('POST_INTERVAL_NOT_ELAPSED')) {
    return '前回の通常記事の公開から一定期間が経過していません。';
  }
  if (msg.includes('INVALID_COMMISSION_TOKEN')) {
    return '依頼トークンが正しくありません。';
  }
  if (msg.includes('COMMISSION_TOKEN_WRONG_WRITER')) {
    return 'この依頼トークンは別のライター宛てです。';
  }
  if (msg.includes('COMMISSION_TOKEN_ALREADY_USED')) {
    return 'この依頼トークンは使用済みです。';
  }
  if (msg.includes('COMMISSION_TOKEN_REVOKED')) {
    return 'この依頼トークンは取り消されています。';
  }
  if (msg.includes('COMMISSION_UNLINK_REQUIRES_UNPUBLISH')) {
    return '公開中の依頼記事から依頼リンクを外すには、一度下書きに戻してください。';
  }
  if (msg.includes('published_requires_region')) {
    return '公開するには取材地を選んでください。';
  }
  if (e?.code === '23505') {
    return 'このスラッグは既に使われています。';
  }
  if (msg.includes('IMAGE_LIMIT_EXCEEDED')) {
    return '本文に入れられる画像は5枚までです。';
  }
  if (msg.includes('IMAGE_HOST_NOT_ALLOWED')) {
    return '許可されていない場所の画像は使えません。「/」から画像を挿入してください。';
  }
  if (msg.includes('FILE_HOST_NOT_ALLOWED')) {
    return '許可されていない場所のファイルは使えません。「/」からファイルを添付してください。';
  }
  if (msg.includes('EMBED_HOST_NOT_ALLOWED')) {
    return '許可されていない埋め込み元です(YouTube / X / Vimeo のみ)。';
  }
  if (msg.includes('BODY_EMPTY_ON_PUBLISH')) {
    return '公開するには本文にテキストを入力してください。';
  }
  return '保存に失敗しました。入力内容を確認して再度お試しください。';
}
