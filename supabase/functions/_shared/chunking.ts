// Deno固有API(Deno.*)やnpm importを一切使わない自己完結モジュール。
// Denoの chunk-article Edge Function と、Node上のVitestテストの両方から
// そのままimportできることを保証するため。

export interface ChunkNode {
  type?: string;
  attrs?: { level?: number; [key: string]: unknown };
  content?: ChunkNode[];
  text?: string;
}

export interface Chunk {
  headingPath: string;
  content: string;
  tokenCount: number;
}

const TEXT_LEAF_TYPES = new Set(['heading', 'paragraph', 'blockquote', 'codeBlock', 'listItem']);
const LIST_CONTAINER_TYPES = new Set(['bulletList', 'orderedList']);
const FLUSH_FLOOR_TOKENS = 500;
const FLUSH_CEILING_TOKENS = 800;

function estimateTokens(text: string): number {
  // CJK(ひらがな・カタカナ・漢字・全角記号)は1文字1トークン、それ以外は4文字1トークン
  // で見積もる簡易ヒューリスティック。OpenAIの正確なトークナイザは使わない
  // (課金計算ではなく、チャンクサイズを500〜800語相当に抑えるための目安)。
  const cjkMatches = text.match(/[　-ヿ㐀-鿿＀-￯]/g);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;
  const restCount = text.length - cjkCount;
  return cjkCount + Math.ceil(restCount / 4);
}

function extractText(node: ChunkNode): string {
  if (node.text) return node.text;
  if (!node.content) return '';
  return node.content.map(extractText).filter((t) => t.length > 0).join(' ');
}

function collectTextBlocks(node: ChunkNode, out: ChunkNode[]): void {
  if (!node.type) return;
  if (TEXT_LEAF_TYPES.has(node.type)) {
    out.push(node);
    return;
  }
  if (LIST_CONTAINER_TYPES.has(node.type)) {
    for (const child of node.content ?? []) collectTextBlocks(child, out);
    return;
  }
  // image/embed/file/toc など、テキストを持たないブロックはスキップする。
}

export function chunkBlocks(blocks: ChunkNode[]): Chunk[] {
  const textBlocks: ChunkNode[] = [];
  for (const block of blocks) collectTextBlocks(block, textBlocks);

  const chunks: Chunk[] = [];
  let buffer: string[] = [];
  let bufferTokens = 0;
  let headingPath: string[] = [];

  const flush = () => {
    if (buffer.length === 0) return;
    chunks.push({
      headingPath: headingPath.join(' > '),
      content: buffer.join('\n\n'),
      tokenCount: bufferTokens,
    });
    buffer = [];
    bufferTokens = 0;
  };

  for (const block of textBlocks) {
    if (block.type === 'heading') {
      // 見出し境界を優先してカットする: 直前のセクションを「古い」headingPathの
      // ままflushしてから、新しいheadingPathに更新する(逆順にすると直前の
      // セクションが新しい見出しのラベルを引き継いでしまう)。
      if (bufferTokens >= FLUSH_FLOOR_TOKENS) flush();
      const level = block.attrs?.level ?? 2;
      const text = extractText(block);
      if (level <= 2) {
        headingPath = text ? [text] : [];
      } else {
        headingPath = [...headingPath.slice(0, 1), text].filter((t) => t.length > 0);
      }
    }

    const text = extractText(block);
    if (text) {
      buffer.push(text);
      bufferTokens += estimateTokens(text);
    }
    if (bufferTokens >= FLUSH_CEILING_TOKENS) flush();
  }
  flush();

  return chunks;
}
