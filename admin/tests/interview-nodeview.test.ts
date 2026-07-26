// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { blockExtensions } from '@wild-media/blocks-renderer';
import { createInterviewPlugin, insertInterviewBlock } from '../src/lib/interview-nodeview';

const fakeDialog = { open: async () => null } as const;

describe('interview-nodeview', () => {
  it('insertInterviewBlock inserts an interview with one empty A turn', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const editor = new Editor({
      element: el,
      extensions: [...blockExtensions, createInterviewPlugin(fakeDialog).extension],
      content: '<p></p>',
    });
    insertInterviewBlock(editor, [
      { key: 'A', name: '米田', role: '', avatarUrl: 'https://img.test/a.webp' },
      { key: 'B', name: '川崎', role: '', avatarUrl: 'https://img.test/b.webp' },
    ]);
    const json = editor.getJSON();
    const interview = json.content?.find((n) => n.type === 'interview');
    expect(interview).toBeDefined();
    expect(interview?.attrs?.speakers).toHaveLength(2);
    expect(interview?.content).toHaveLength(1);
    expect(interview?.content?.[0].type).toBe('turn');
    expect(interview?.content?.[0].attrs?.speaker).toBe('A');
    editor.destroy();
  });

  it('renders speaker cards and add-turn buttons as decorations over interview blocks', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const editor = new Editor({
      element: el,
      extensions: [...blockExtensions, createInterviewPlugin(fakeDialog).extension],
      content: {
        type: 'doc',
        content: [{
          type: 'interview',
          attrs: {
            speakers: [
              { key: 'A', name: '米田', role: '聞き手', avatarUrl: 'https://img.test/a.webp' },
              { key: 'B', name: '川崎', role: 'Kaeru', avatarUrl: 'https://img.test/b.webp' },
            ],
          },
          content: [
            { type: 'turn', attrs: { speaker: 'A' }, content: [{ type: 'text', text: 'hi' }] },
          ],
        }],
      },
    });
    const dom = el.querySelector('.interview-block');
    expect(dom).not.toBeNull();
    expect(dom!.querySelectorAll('[data-speaker-card]')).toHaveLength(2);
    expect(dom!.querySelectorAll('[data-add-turn]').length).toBeGreaterThanOrEqual(1);
    editor.destroy();
  });
});
