// 改行/段落境界を作るタグ(見出し・段落・改行・リスト・引用等)は空白に、
// strong/em/a等の純粋なインラインタグは何もない文字列に置換する。
// 全タグを一律スペース化すると「<strong>鳥</strong>」のような語中の
// インライン強調タグの前後にまで余分な空白が入ってしまうため区別している。
const BLOCK_TAG_RE = /<\/?(p|div|br|li|ul|ol|h[1-6]|blockquote|table|tr|td|th|figure|figcaption)\b[^>]*>/gi;

// Strips HTML tags, decodes the common named entities, collapses whitespace,
// and truncates at `maxLen` (character units, not bytes). Appends '…' when truncated.
// Used as the SEO description when an article has no explicit `articles.description`.
export function fallbackDescription(bodyHtml: string, maxLen = 160): string {
  const stripped = bodyHtml
    .replace(BLOCK_TAG_RE, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  if (stripped === '') return '';
  const chars = [...stripped];
  if (chars.length <= maxLen) return stripped;
  return chars.slice(0, maxLen).join('') + '…';
}
