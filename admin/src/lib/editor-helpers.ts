import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

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
  if (msg.includes('INVALID_COMMISSION_CODE')) {
    return '依頼者コードが正しくありません。';
  }
  if (msg.includes('COMMISSION_UNLINK_REQUIRES_UNPUBLISH')) {
    return '公開中の依頼記事から依頼リンクを外すには、一度下書きに戻してください。';
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
  if (msg.includes('HTML_IMG_NOT_ALLOWED')) {
    return '本文に <img> タグは書けません。「/」から画像を挿入してください。';
  }
  if (msg.includes('IMAGE_SYNTAX_NOT_ALLOWED')) {
    return '画像は「/」から挿入したものだけ使えます(参照形式のリンクは使えません)。';
  }
  return '保存に失敗しました。入力内容を確認して再度お試しください。';
}

// 公開サイトの renderMarkdown(src/lib/content.ts)と同じ規則で img を絞る。
// 片方だけ緩いと「プレビューで見えたのに公開ページで消える」ことになる。
export function renderMarkdownPreview(md: string, imageBaseUrl: string): string {
  const html = marked.parse(md, { async: false }) as string;
  const prefix = imageBaseUrl === '' ? null : `${imageBaseUrl}/`;
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2']),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: ['src', 'alt'],
    },
    exclusiveFilter: (frame) =>
      frame.tag === 'img' &&
      (prefix === null || !(frame.attribs.src ?? '').startsWith(prefix)),
  });
}
