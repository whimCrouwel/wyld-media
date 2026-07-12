import { describe, it, expect } from 'vitest';
import { extractHeadings } from '../src/lib/toc-panel';
import type { JSONContent } from '@tiptap/core';

describe('extractHeadings', () => {
  it('returns an empty array when there are no headings', () => {
    expect(extractHeadings({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '本文' }] }],
    })).toEqual([]);
  });

  it('extracts level/text/pos for each top-level heading in order', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '第一章' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '本文' }] },
        { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: '第一節' }] },
      ],
    };
    const headings = extractHeadings(doc);
    expect(headings).toHaveLength(2);
    expect(headings[0]).toEqual({ level: 2, text: '第一章', pos: 0 });
    // heading1 nodeSize = 3 chars + 2 = 5; paragraph nodeSize = 2 chars + 2 = 4
    expect(headings[1]).toEqual({ level: 3, text: '第一節', pos: 9 });
  });
});
