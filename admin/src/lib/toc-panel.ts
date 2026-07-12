import type { Editor, JSONContent } from '@tiptap/core';

export interface HeadingInfo {
  level: number;
  text: string;
  pos: number;
}

const ATOM_TYPES = new Set(['image', 'file', 'embed', 'horizontalRule', 'toc', 'hardBreak']);

function nodeText(node: JSONContent): string {
  if (node.text) return node.text;
  return (node.content ?? []).map(nodeText).join('');
}

// JSONContent(プレーンな JSON)には ProseMirror の position 情報が無いため、
// nodeSize の計算規則(テキストは文字数、atom ノードは1、コンテナノードは
// 子の合計+2)を模倣して見出しの実位置を求める。トップレベルの見出しのみを
// 対象とする(この schema では見出しは常にトップレベル)。
function nodeSize(node: JSONContent): number {
  if (node.type === 'text') return (node.text ?? '').length;
  if (ATOM_TYPES.has(node.type ?? '')) return 1;
  const childrenSize = (node.content ?? []).reduce((sum, c) => sum + nodeSize(c), 0);
  return childrenSize + 2;
}

export function extractHeadings(doc: JSONContent): HeadingInfo[] {
  const headings: HeadingInfo[] = [];
  let pos = 0;
  for (const node of doc.content ?? []) {
    if (node.type === 'heading') {
      headings.push({
        level: (node.attrs?.level as number | undefined) ?? 2,
        text: nodeText(node),
        pos,
      });
    }
    pos += nodeSize(node);
  }
  return headings;
}

export function renderTocPanel(editor: Editor, panelEl: HTMLElement): void {
  const render = () => {
    const headings = extractHeadings(editor.getJSON());
    panelEl.replaceChildren();
    if (headings.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = '見出しを設定すると表示されます';
      panelEl.append(empty);
      return;
    }
    const list = document.createElement('ul');
    for (const h of headings) {
      const item = document.createElement('li');
      item.dataset.level = String(h.level);
      const link = document.createElement('button');
      link.type = 'button';
      link.textContent = h.text;
      link.addEventListener('click', () => {
        const dom = editor.view.nodeDOM(h.pos) as HTMLElement | null;
        dom?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      item.append(link);
      list.append(item);
    }
    panelEl.append(list);
  };

  render();
  editor.on('update', render);
}
