import { describe, it, expect, vi } from 'vitest';
import { detectEmbedProvider, insertEmbedBlock } from '../src/lib/embed-dialog';

describe('detectEmbedProvider', () => {
  it('detects youtube.com and youtu.be', () => {
    expect(detectEmbedProvider('https://www.youtube.com/watch?v=abc')).toBe('youtube');
    expect(detectEmbedProvider('https://youtu.be/abc')).toBe('youtube');
  });
  it('detects twitter.com and x.com', () => {
    expect(detectEmbedProvider('https://twitter.com/user/status/1')).toBe('twitter');
    expect(detectEmbedProvider('https://x.com/user/status/1')).toBe('twitter');
  });
  it('detects vimeo.com and player.vimeo.com', () => {
    expect(detectEmbedProvider('https://vimeo.com/12345')).toBe('vimeo');
    expect(detectEmbedProvider('https://player.vimeo.com/video/12345')).toBe('vimeo');
  });
  it('returns null for a bare host without www (matches the DB allowlist exactly)', () => {
    expect(detectEmbedProvider('https://youtube.com/watch?v=abc')).toBeNull();
  });
  it('returns null for a disallowed host', () => {
    expect(detectEmbedProvider('https://evil.example/embed/1')).toBeNull();
  });
  it('returns null for an invalid url', () => {
    expect(detectEmbedProvider('not a url')).toBeNull();
  });
});

function fakeEditor() {
  const run = vi.fn();
  const insertContent = vi.fn(() => ({ run }));
  const focus = vi.fn(() => ({ insertContent }));
  const chain = vi.fn(() => ({ focus }));
  return { chain, insertContent, run } as unknown as import('@tiptap/core').Editor & {
    insertContent: typeof insertContent;
  };
}

describe('insertEmbedBlock', () => {
  it('inserts an embed node for an allowed provider url', () => {
    const editor = fakeEditor();
    const result = insertEmbedBlock(editor, 'https://www.youtube.com/watch?v=abc');
    expect(result).toEqual({ ok: true });
    expect(editor.insertContent).toHaveBeenCalledWith({
      type: 'embed', attrs: { url: 'https://www.youtube.com/watch?v=abc', provider: 'youtube' },
    });
  });

  it('rejects a disallowed host without touching the editor', () => {
    const editor = fakeEditor();
    const result = insertEmbedBlock(editor, 'https://evil.example/embed/1');
    expect(result).toEqual({
      ok: false,
      message: '許可されていない埋め込み元です(YouTube / X / Vimeo のみ)。',
    });
    expect(editor.insertContent).not.toHaveBeenCalled();
  });
});
