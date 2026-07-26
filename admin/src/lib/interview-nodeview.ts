import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { InterviewDialogController, Speaker } from './interview-dialog';

const KEY = new PluginKey('interview-decorations');

export interface InterviewPluginBundle {
  extension: Extension;
}

export function createInterviewPlugin(dialog: InterviewDialogController): InterviewPluginBundle {
  const extension = Extension.create({
    name: 'interviewDecorations',
    addProseMirrorPlugins() {
      const editor = this.editor;
      return [
        new Plugin({
          key: KEY,
          props: {
            decorations(state) {
              const decos: Decoration[] = [];
              state.doc.forEach((node, offset) => {
                if (node.type.name !== 'interview') return;
                const speakers: Speaker[] = (node.attrs.speakers ?? []) as Speaker[];
                // 話者カード (interview の直前)
                decos.push(
                  Decoration.widget(
                    offset + 1,
                    () => buildSpeakersHeader(editor, dialog, offset, speakers),
                    { side: -1 },
                  ),
                );
                // ＋発言追加ボタン (interview の末尾)
                decos.push(
                  Decoration.widget(
                    offset + node.nodeSize - 1,
                    () => buildAddTurnButton(editor, offset, speakers),
                    { side: 1 },
                  ),
                );
                // 各 turn の話者ラベル + 切替
                let cursor = offset + 1;
                node.forEach((turn) => {
                  const turnPos = cursor;
                  const at = cursor + 1;
                  decos.push(
                    Decoration.widget(
                      at,
                      () => buildTurnHeader(editor, turnPos, turn.attrs.speaker, speakers),
                      { side: -1 },
                    ),
                  );
                  cursor += turn.nodeSize;
                });
              });
              return DecorationSet.create(state.doc, decos);
            },
          },
        }),
      ];
    },
  });
  return { extension };
}

function buildSpeakersHeader(
  editor: Editor,
  dialog: InterviewDialogController,
  interviewPos: number,
  speakers: Speaker[],
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'interview-block__speakers';
  el.contentEditable = 'false';
  speakers.forEach((s) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.setAttribute('data-speaker-card', s.key);
    card.className = 'speaker-card-inline';
    card.innerHTML = `
      ${s.avatarUrl
        ? `<img src="${escapeAttr(s.avatarUrl)}" alt="${escapeAttr(s.name)}" />`
        : '<div class="avatar-placeholder">?</div>'}
      <div>
        <span class="speaker-card-inline__name">${escapeHtml(s.name || '(未設定)')}</span>
        ${s.role ? `<span class="speaker-card-inline__role">${escapeHtml(s.role)}</span>` : ''}
      </div>
    `;
    card.addEventListener('click', async () => {
      const updated = await dialog.open(speakers);
      if (!updated) return;
      // 話者数が減った場合、その key を参照している turn を削除する
      const allowedKeys = new Set(updated.map((sp) => sp.key));
      const node = editor.state.doc.nodeAt(interviewPos);
      if (!node) return;
      // 削除する turn の位置を集める
      const removals: Array<{ from: number; to: number }> = [];
      let cursor = interviewPos + 1;
      node.forEach((turn) => {
        if (turn.type.name === 'turn' && !allowedKeys.has(turn.attrs.speaker)) {
          removals.push({ from: cursor, to: cursor + turn.nodeSize });
        }
        cursor += turn.nodeSize;
      });
      // 発言が消える場合は確認 (spec の話者削除ポリシー)
      if (removals.length > 0) {
        const ok = window.confirm(
          `削除された話者の発言 ${removals.length} 件も同時に削除します。続行しますか?`,
        );
        if (!ok) return;
      }
      const tr = editor.state.tr;
      for (const r of removals.slice().reverse()) tr.delete(r.from, r.to);
      // speakers attr を更新
      tr.setNodeMarkup(interviewPos, undefined, { speakers: updated });
      // interview が turn 0 件になったら A の空 turn を追加
      const updatedNode = tr.doc.nodeAt(interviewPos);
      if (updatedNode && updatedNode.childCount === 0) {
        const turnType = editor.schema.nodes.turn;
        tr.insert(interviewPos + 1, turnType.create({ speaker: 'A' }));
      }
      editor.view.dispatch(tr);
    });
    el.appendChild(card);
  });
  return el;
}

function buildAddTurnButton(editor: Editor, interviewPos: number, speakers: Speaker[]): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'interview-block__add-turn';
  wrapper.contentEditable = 'false';
  wrapper.setAttribute('data-add-turn', '1');
  const label = document.createElement('span');
  label.textContent = '＋ 発言を追加';
  wrapper.appendChild(label);
  speakers.forEach((s) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = s.name || s.key;
    btn.addEventListener('click', () => {
      const node = editor.state.doc.nodeAt(interviewPos);
      if (!node) return;
      const insertAt = interviewPos + node.nodeSize - 1;
      const turnType = editor.schema.nodes.turn;
      const tr = editor.state.tr.insert(insertAt, turnType.create({ speaker: s.key }));
      editor.view.dispatch(tr);
    });
    wrapper.appendChild(btn);
  });
  return wrapper;
}

let openSpeakerMenu: HTMLElement | null = null;

function buildTurnHeader(
  editor: Editor,
  turnPos: number,
  currentSpeaker: string,
  speakers: Speaker[],
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'turn__header';
  el.contentEditable = 'false';
  const label = document.createElement('button');
  label.type = 'button';
  const currentName = speakers.find((s) => s.key === currentSpeaker)?.name ?? currentSpeaker;
  label.textContent = currentName;
  label.addEventListener('click', () => {
    // 既に開いているポップオーバーがあれば閉じる (再クリックでの多重生成を防ぐ)
    if (openSpeakerMenu) {
      openSpeakerMenu.remove();
      openSpeakerMenu = null;
    }
    // 話者選択ポップオーバー
    const menu = document.createElement('div');
    menu.className = 'turn__speaker-menu';
    speakers.forEach((s) => {
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.textContent = s.name || s.key;
      opt.addEventListener('click', () => {
        const node = editor.state.doc.nodeAt(turnPos);
        if (!node) return;
        const tr = editor.state.tr.setNodeMarkup(turnPos, undefined, { speaker: s.key });
        editor.view.dispatch(tr);
        menu.remove();
        if (openSpeakerMenu === menu) openSpeakerMenu = null;
      });
      menu.appendChild(opt);
    });
    document.body.appendChild(menu);
    openSpeakerMenu = menu;
    const rect = label.getBoundingClientRect();
    menu.style.position = 'absolute';
    menu.style.top = `${rect.bottom + window.scrollY}px`;
    menu.style.left = `${rect.left + window.scrollX}px`;
    // クリック外で閉じる
    const closer = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) {
        menu.remove();
        if (openSpeakerMenu === menu) openSpeakerMenu = null;
        document.removeEventListener('click', closer);
      }
    };
    setTimeout(() => document.addEventListener('click', closer), 0);
  });
  el.appendChild(label);
  return el;
}

export function insertInterviewBlock(editor: Editor, speakers: Speaker[]): void {
  editor
    .chain()
    .focus()
    .insertContent({
      type: 'interview',
      attrs: { speakers },
      content: [{ type: 'turn', attrs: { speaker: 'A' }, content: [] }],
    })
    .run();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}
