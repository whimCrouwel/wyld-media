const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidArticleSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
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
