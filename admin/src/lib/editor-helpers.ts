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
  return '保存に失敗しました。入力内容を確認して再度お試しください。';
}

export function renderMarkdownPreview(md: string): string {
  const html = marked.parse(md, { async: false }) as string;
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2']),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: ['src', 'alt'],
    },
  });
}
