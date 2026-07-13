import { describe, it, expect } from 'vitest';
import { chunkBlocks } from '../supabase/functions/_shared/chunking';

describe('chunkBlocks', () => {
  it('returns an empty array for an empty body', () => {
    expect(chunkBlocks([])).toEqual([]);
  });

  it('produces one chunk for a short heading + paragraph', () => {
    const blocks = [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '川辺にて' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '今日は川辺を観察した。' }] },
    ];
    const chunks = chunkBlocks(blocks);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].headingPath).toBe('川辺にて');
    expect(chunks[0].content).toContain('川辺にて');
    expect(chunks[0].content).toContain('今日は川辺を観察した。');
    expect(chunks[0].tokenCount).toBeGreaterThan(0);
  });

  it('skips image/embed/file/toc blocks (no extractable text)', () => {
    const blocks = [
      { type: 'paragraph', content: [{ type: 'text', text: '本文' }] },
      { type: 'image', attrs: { url: 'https://img.test/a.webp' } },
      { type: 'embed', attrs: { url: 'https://youtube.com/x', provider: 'youtube' } },
      { type: 'file', attrs: { url: 'https://img.test/a.pdf', filename: 'a.pdf' } },
      { type: 'toc' },
    ];
    const chunks = chunkBlocks(blocks);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('本文');
  });

  it('extracts text from nested bulletList > listItem > paragraph', () => {
    const blocks = [
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '項目1' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '項目2' }] }] },
        ],
      },
    ];
    const chunks = chunkBlocks(blocks);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain('項目1');
    expect(chunks[0].content).toContain('項目2');
  });

  it('force-flushes mid-section once token count crosses 800, without a heading', () => {
    // 900文字のCJKテキストを持つ単一段落 = 推定トークン数900(> 800)
    const longText = '観'.repeat(900);
    const blocks = [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '長い章' }] },
      { type: 'paragraph', content: [{ type: 'text', text: longText }] },
      { type: 'paragraph', content: [{ type: 'text', text: '続きの段落' }] },
    ];
    const chunks = chunkBlocks(blocks);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].headingPath).toBe('長い章');
    expect(chunks[1].headingPath).toBe('長い章');
    expect(chunks[1].content).toContain('続きの段落');
  });

  it('flushes at a heading boundary once buffered tokens reach 500, and the new chunk keeps the new heading', () => {
    // 各段落520文字のCJK(推定520トークン、500の壁を単独で越える)
    const para1 = '観'.repeat(520);
    const para2 = '察'.repeat(520);
    const blocks = [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '第一章' }] },
      { type: 'paragraph', content: [{ type: 'text', text: para1 }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '第二章' }] },
      { type: 'paragraph', content: [{ type: 'text', text: para2 }] },
    ];
    const chunks = chunkBlocks(blocks);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].headingPath).toBe('第一章');
    expect(chunks[1].headingPath).toBe('第二章');
  });

  it('tracks a two-level heading path (h2 > h3), resetting h3 on a new h2', () => {
    const blocks = [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '装備' }] },
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: '長靴' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '長靴の話。' }] },
    ];
    const chunks = chunkBlocks(blocks);
    expect(chunks[chunks.length - 1].headingPath).toBe('装備 > 長靴');
  });
});
