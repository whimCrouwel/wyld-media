import { describe, it, expect, vi } from 'vitest';
import { insertImageBlock, insertFileBlock, insertImageUrlBlock } from '../src/lib/block-uploads';

vi.mock('../src/lib/r2-upload', () => ({
  uploadToR2: vi.fn(async (_supabase: unknown, file: File, kind: 'image' | 'file') => ({
    url: `https://img.test/${kind}-${file.name}`,
  })),
}));

function fakeEditor() {
  const run = vi.fn();
  const insertContent = vi.fn(() => ({ run }));
  const focus = vi.fn(() => ({ insertContent }));
  const chain = vi.fn(() => ({ focus }));
  return { chain, insertContent, run } as unknown as import('@tiptap/core').Editor & {
    insertContent: typeof insertContent; run: typeof run;
  };
}

describe('insertImageBlock', () => {
  it('uploads then inserts an image node with the uploaded url', async () => {
    const editor = fakeEditor();
    const file = new File(['x'], 'photo.webp', { type: 'image/webp' });
    await insertImageBlock({} as never, editor, file);
    expect(editor.insertContent).toHaveBeenCalledWith({
      type: 'image', attrs: { url: 'https://img.test/image-photo.webp', caption: null, alt: '' },
    });
    expect(editor.run).toHaveBeenCalled();
  });
});

describe('insertFileBlock', () => {
  it('uploads then inserts a file node with the uploaded url and filename', async () => {
    const editor = fakeEditor();
    const file = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
    await insertFileBlock({} as never, editor, file);
    expect(editor.insertContent).toHaveBeenCalledWith({
      type: 'file', attrs: { url: 'https://img.test/file-doc.pdf', filename: 'doc.pdf' },
    });
  });
});

describe('insertImageUrlBlock', () => {
  it('inserts an image node directly without uploading', () => {
    const editor = fakeEditor();
    insertImageUrlBlock(editor, 'https://img.test/reused.webp');
    expect(editor.insertContent).toHaveBeenCalledWith({
      type: 'image', attrs: { url: 'https://img.test/reused.webp', caption: null, alt: '' },
    });
  });
});
