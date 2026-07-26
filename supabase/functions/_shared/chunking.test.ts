import { describe, expect, it } from 'vitest';
import { chunkBlocks } from './chunking';

describe('chunkBlocks — interview', () => {
  it('extracts turn text as separate chunks', () => {
    const blocks = [
      {
        type: 'interview',
        attrs: {
          speakers: [
            { key: 'A', name: '米田', role: '聞き手', avatarUrl: 'https://img.test/a.webp' },
            { key: 'B', name: '川崎', role: '代表', avatarUrl: 'https://img.test/b.webp' },
          ],
        },
        content: [
          { type: 'turn', attrs: { speaker: 'A' }, content: [{ type: 'text', text: '最初の質問です' }] },
          { type: 'turn', attrs: { speaker: 'B' }, content: [{ type: 'text', text: '答えはこうです' }] },
        ],
      },
    ];
    const chunks = chunkBlocks(blocks);
    const joined = chunks.map((c) => c.content).join(' | ');
    expect(joined).toContain('最初の質問です');
    expect(joined).toContain('答えはこうです');
  });

  it('does NOT include speaker names or roles in chunk text', () => {
    const blocks = [
      {
        type: 'interview',
        attrs: {
          speakers: [
            { key: 'A', name: 'ヨネダタカアキ', role: 'ライター', avatarUrl: 'https://img.test/a.webp' },
            { key: 'B', name: 'カワサキアケミコ', role: 'カエルデザイン代表', avatarUrl: 'https://img.test/b.webp' },
          ],
        },
        content: [
          { type: 'turn', attrs: { speaker: 'A' }, content: [{ type: 'text', text: '本文A' }] },
        ],
      },
    ];
    const joined = chunkBlocks(blocks).map((c) => c.content).join(' ');
    expect(joined).not.toContain('ヨネダタカアキ');
    expect(joined).not.toContain('ライター');
    expect(joined).not.toContain('カワサキアケミコ');
    expect(joined).not.toContain('カエルデザイン代表');
    expect(joined).toContain('本文A');
  });
});
