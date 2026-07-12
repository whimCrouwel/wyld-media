import { describe, it, expect, vi } from 'vitest';
import {
  detectEmbedProvider, insertEmbedBlock, extractYouTubeId, extractVimeoId, normalizeEmbedUrl,
} from '../src/lib/embed-dialog';

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

describe('extractYouTubeId', () => {
  it('extracts the id from a watch URL', () => {
    expect(extractYouTubeId('https://www.youtube.com/watch?v=abc123')).toBe('abc123');
  });
  it('extracts the id when v is not the first query param', () => {
    expect(extractYouTubeId('https://www.youtube.com/watch?list=xyz&v=abc123')).toBe('abc123');
  });
  it('extracts the id from a youtu.be short URL', () => {
    expect(extractYouTubeId('https://youtu.be/abc123')).toBe('abc123');
  });
  it('strips a trailing tracking param from a youtu.be short URL', () => {
    expect(extractYouTubeId('https://youtu.be/abc123?si=tracking')).toBe('abc123');
  });
  it('extracts the id from an already-normalized embed URL', () => {
    expect(extractYouTubeId('https://www.youtube.com/embed/abc123')).toBe('abc123');
  });
  it('returns null when the watch URL has no v param', () => {
    expect(extractYouTubeId('https://www.youtube.com/watch?list=xyz')).toBeNull();
  });
  it('returns null for an unrecognized host', () => {
    expect(extractYouTubeId('https://vimeo.com/123')).toBeNull();
  });
  it('returns null for an invalid url', () => {
    expect(extractYouTubeId('not a url')).toBeNull();
  });
});

describe('extractVimeoId', () => {
  it('extracts the numeric id from a bare vimeo.com URL', () => {
    expect(extractVimeoId('https://vimeo.com/76979871')).toBe('76979871');
  });
  it('extracts the numeric id from a player.vimeo.com embed URL', () => {
    expect(extractVimeoId('https://player.vimeo.com/video/76979871')).toBe('76979871');
  });
  it('returns null for a non-numeric vimeo.com path', () => {
    expect(extractVimeoId('https://vimeo.com/channels/staffpicks')).toBeNull();
  });
  it('returns null for an invalid url', () => {
    expect(extractVimeoId('not a url')).toBeNull();
  });
});

describe('normalizeEmbedUrl', () => {
  it('normalizes a youtube watch URL to the embed form', () => {
    expect(normalizeEmbedUrl('https://www.youtube.com/watch?v=abc123', 'youtube'))
      .toBe('https://www.youtube.com/embed/abc123');
  });
  it('normalizes a youtu.be URL to the embed form', () => {
    expect(normalizeEmbedUrl('https://youtu.be/abc123?si=tracking', 'youtube'))
      .toBe('https://www.youtube.com/embed/abc123');
  });
  it('normalizes a bare vimeo.com URL to the player form', () => {
    expect(normalizeEmbedUrl('https://vimeo.com/76979871', 'vimeo'))
      .toBe('https://player.vimeo.com/video/76979871');
  });
  it('leaves an already-normalized player.vimeo.com URL unchanged', () => {
    expect(normalizeEmbedUrl('https://player.vimeo.com/video/76979871', 'vimeo'))
      .toBe('https://player.vimeo.com/video/76979871');
  });
  it('falls back to the original URL when the id cannot be extracted', () => {
    expect(normalizeEmbedUrl('https://www.youtube.com/watch?list=xyz', 'youtube'))
      .toBe('https://www.youtube.com/watch?list=xyz');
  });
  it('leaves twitter URLs untouched (no iframe-embed form exists)', () => {
    expect(normalizeEmbedUrl('https://x.com/user/status/1', 'twitter'))
      .toBe('https://x.com/user/status/1');
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
  it('inserts an embed node with the youtube url normalized to its embed form', () => {
    const editor = fakeEditor();
    const result = insertEmbedBlock(editor, 'https://www.youtube.com/watch?v=abc');
    expect(result).toEqual({ ok: true });
    expect(editor.insertContent).toHaveBeenCalledWith({
      type: 'embed', attrs: { url: 'https://www.youtube.com/embed/abc', provider: 'youtube' },
    });
  });

  it('inserts an embed node with the vimeo url normalized to its player form', () => {
    const editor = fakeEditor();
    const result = insertEmbedBlock(editor, 'https://vimeo.com/76979871');
    expect(result).toEqual({ ok: true });
    expect(editor.insertContent).toHaveBeenCalledWith({
      type: 'embed', attrs: { url: 'https://player.vimeo.com/video/76979871', provider: 'vimeo' },
    });
  });

  it('inserts an embed node with the twitter url unchanged', () => {
    const editor = fakeEditor();
    const result = insertEmbedBlock(editor, 'https://x.com/user/status/1');
    expect(result).toEqual({ ok: true });
    expect(editor.insertContent).toHaveBeenCalledWith({
      type: 'embed', attrs: { url: 'https://x.com/user/status/1', provider: 'twitter' },
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
