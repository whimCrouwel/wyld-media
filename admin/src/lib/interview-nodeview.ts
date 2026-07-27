import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView, NodeView, ViewMutationRecord } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { InterviewDialogController, Speaker } from './interview-dialog';

const KEY = new PluginKey('interview-editor-view');

export interface InterviewPluginBundle {
  extension: Extension;
}

// CMS エディタ側のインタビュー表示。
// - Turn を NodeView でチャット風レイアウトに描く (avatar + who + bubble)。
// - Interview 直下に「話者を編集」ピル型ツールバー(装飾)と「＋発言を追加」(装飾)を出す。
// - 連続同話者 turn には Decoration.node で `turn--cont` クラスを付与し、
//   CSS 側で avatar/who を畳んで bubble のみ表示する。
export function createInterviewPlugin(dialog: InterviewDialogController): InterviewPluginBundle {
  const extension = Extension.create({
    name: 'interviewEditorView',
    addProseMirrorPlugins() {
      const editor = this.editor;
      return [
        new Plugin({
          key: KEY,
          props: {
            nodeViews: {
              turn: (node, view, getPos) => new TurnNodeView(node, view, getPos, editor),
            },
            decorations(state) {
              const decos: Decoration[] = [];
              state.doc.forEach((node, offset) => {
                if (node.type.name !== 'interview') return;
                const speakers = (node.attrs.speakers ?? []) as Speaker[];

                // ピル型ツールバー(話者一覧 + 「話者を編集」ボタン)
                decos.push(
                  Decoration.widget(
                    offset + 1,
                    () => buildSpeakerToolbar(editor, dialog, offset, speakers),
                    { side: -1 },
                  ),
                );

                // ＋発言を追加
                decos.push(
                  Decoration.widget(
                    offset + node.nodeSize - 1,
                    () => buildAddTurnButton(editor, offset, speakers),
                    { side: 1 },
                  ),
                );

                // 連続同話者 turn に turn--cont を付ける + 唯一 turn に turn--only を付ける
                // (turn--only は CSS で削除ボタンを隠す — 最後の 1 発言は消せない)
                const onlyTurn = node.childCount === 1;
                let cursor = offset + 1;
                let prevKey: string | null = null;
                node.forEach((turn) => {
                  const turnPos = cursor;
                  if (turn.type.name === 'turn') {
                    if (turn.attrs.speaker === prevKey) {
                      decos.push(Decoration.node(turnPos, turnPos + turn.nodeSize, { class: 'turn--cont' }));
                    }
                    if (onlyTurn) {
                      decos.push(Decoration.node(turnPos, turnPos + turn.nodeSize, { class: 'turn--only' }));
                    }
                    prevKey = turn.attrs.speaker;
                  }
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

// ==================== Turn NodeView ====================

class TurnNodeView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private editor: Editor;
  private getPos: () => number | undefined;
  private speakerKey: string;
  private avatarEl: HTMLImageElement;
  private whoEl: HTMLElement;
  private deleteBtn: HTMLButtonElement;

  constructor(node: PMNode, _view: EditorView, getPos: () => number | undefined, editor: Editor) {
    this.editor = editor;
    this.getPos = getPos;
    this.speakerKey = node.attrs.speaker;

    this.dom = document.createElement('div');
    this.dom.setAttribute('data-block', 'turn');
    this.dom.setAttribute('data-speaker', this.speakerKey);
    this.dom.className = `turn turn--${this.speakerKey}`;

    this.avatarEl = document.createElement('img');
    this.avatarEl.className = 'turn__avatar';
    this.avatarEl.contentEditable = 'false';

    this.whoEl = document.createElement('div');
    this.whoEl.className = 'turn__who';
    this.whoEl.contentEditable = 'false';

    const bubble = document.createElement('div');
    bubble.className = 'turn__bubble';

    this.deleteBtn = document.createElement('button');
    this.deleteBtn.type = 'button';
    this.deleteBtn.className = 'turn__delete';
    this.deleteBtn.setAttribute('aria-label', 'この発言を削除');
    this.deleteBtn.setAttribute('data-turn-delete', '1');
    this.deleteBtn.title = 'この発言を削除';
    this.deleteBtn.textContent = '×';
    this.deleteBtn.contentEditable = 'false';

    this.dom.append(this.avatarEl, this.whoEl, bubble, this.deleteBtn);
    this.contentDOM = bubble;

    this.render();

    this.whoEl.addEventListener('mousedown', (e) => this.onWhoMousedown(e));
    this.deleteBtn.addEventListener('mousedown', (e) => this.onDeleteMousedown(e));
  }

  // 親の interview から speakers を取り、自分の speakerKey に対応する Speaker を返す。
  private currentSpeaker(): Speaker | undefined {
    const pos = this.getPos();
    if (pos == null) return undefined;
    let doc;
    try { doc = this.editor.state.doc; } catch { return undefined; }
    try {
      const resolved = doc.resolve(pos);
      const parent = resolved.parent;
      if (!parent || parent.type.name !== 'interview') return undefined;
      const speakers = (parent.attrs.speakers ?? []) as Speaker[];
      return speakers.find((s) => s.key === this.speakerKey);
    } catch {
      return undefined;
    }
  }

  private render(): void {
    const s = this.currentSpeaker();
    if (s?.avatarUrl) {
      this.avatarEl.src = s.avatarUrl;
      this.avatarEl.alt = s.name || '';
      this.avatarEl.hidden = false;
    } else {
      this.avatarEl.removeAttribute('src');
      this.avatarEl.hidden = true;
    }
    const name = s?.name || this.speakerKey;
    const role = s?.role || '';
    // 名前は button として、クリックで話者切替ポップオーバーを開く。
    this.whoEl.innerHTML =
      `<button type="button" class="turn__name">${escapeHtml(name)}</button>` +
      (role ? `<span class="turn__role">${escapeHtml(role)}</span>` : '');
  }

  update(node: PMNode): boolean {
    if (node.type.name !== 'turn') return false;
    if (node.attrs.speaker !== this.speakerKey) {
      this.dom.classList.remove(`turn--${this.speakerKey}`);
      this.speakerKey = node.attrs.speaker;
      this.dom.classList.add(`turn--${this.speakerKey}`);
      this.dom.setAttribute('data-speaker', this.speakerKey);
    }
    // 親 interview の speakers が変わった場合も反映するため常に再描画。
    this.render();
    return true;
  }

  // 最後の 1 発言は削除させない (ブロックごと消すには「ブロックを削除」を使わせる)。
  // 表示側は decorations() が turn--only クラスをつけて CSS で隠す。
  // ここは実行時の防衛線として parent.childCount を再確認する。
  private onDeleteMousedown(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    const pos = this.getPos();
    if (pos == null) return;
    const doc = this.editor.state.doc;
    const node = doc.nodeAt(pos);
    if (!node || node.type.name !== 'turn') return;
    const parent = doc.resolve(pos).parent;
    if (parent.type.name !== 'interview' || parent.childCount <= 1) return;
    const tr = this.editor.state.tr.delete(pos, pos + node.nodeSize);
    this.editor.view.dispatch(tr);
  }

  private onWhoMousedown(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    if (!target.closest('.turn__name')) return;
    e.preventDefault();
    e.stopPropagation();

    const pos = this.getPos();
    if (pos == null) return;
    const doc = this.editor.state.doc;
    let speakers: Speaker[] = [];
    try {
      const parent = doc.resolve(pos).parent;
      if (parent?.type.name === 'interview') speakers = (parent.attrs.speakers ?? []) as Speaker[];
    } catch { /* noop */ }

    if (openSpeakerMenu) {
      openSpeakerMenu.remove();
      openSpeakerMenu = null;
    }
    const menu = document.createElement('div');
    menu.className = 'turn__speaker-menu';
    speakers.forEach((s) => {
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.textContent = s.name || s.key;
      opt.addEventListener('click', () => {
        const p = this.getPos();
        if (p == null) return;
        const node = this.editor.state.doc.nodeAt(p);
        if (!node) return;
        const tr = this.editor.state.tr.setNodeMarkup(p, undefined, { speaker: s.key });
        this.editor.view.dispatch(tr);
        menu.remove();
        if (openSpeakerMenu === menu) openSpeakerMenu = null;
      });
      menu.appendChild(opt);
    });
    document.body.appendChild(menu);
    openSpeakerMenu = menu;
    const rect = (target.closest('.turn__name') as HTMLElement).getBoundingClientRect();
    menu.style.position = 'absolute';
    menu.style.top = `${rect.bottom + window.scrollY + 4}px`;
    menu.style.left = `${rect.left + window.scrollX}px`;
    const closer = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node)) {
        menu.remove();
        if (openSpeakerMenu === menu) openSpeakerMenu = null;
        document.removeEventListener('click', closer);
      }
    };
    setTimeout(() => document.addEventListener('click', closer), 0);
  }

  // Speaker toolbar / add-turn ボタンなど NodeView 外の DOM 変更を PM に「無視」させる。
  // これがないと、それらの外部 mutation で NodeView 全体が捨てられて再構築されうる。
  ignoreMutation(mutation: ViewMutationRecord): boolean {
    // contentDOM (bubble) の子孫変更は PM の管轄。それ以外は無視。
    return !this.contentDOM.contains(mutation.target);
  }
}

// ==================== Speaker toolbar (pill) ====================

function buildSpeakerToolbar(
  editor: Editor,
  dialog: InterviewDialogController,
  interviewPos: number,
  speakers: Speaker[],
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'interview-block__speakers';
  wrap.contentEditable = 'false';

  speakers.forEach((s) => {
    const chip = document.createElement('span');
    chip.className = 'speaker-chip';
    chip.setAttribute('data-speaker-chip', s.key);
    chip.innerHTML =
      (s.avatarUrl
        ? `<img src="${escapeAttr(s.avatarUrl)}" alt="${escapeAttr(s.name)}" />`
        : '<span class="avatar-placeholder">?</span>') +
      `<span class="speaker-chip__k">${s.key}</span>` +
      `<span class="speaker-chip__name">${escapeHtml(s.name || '(未設定)')}</span>`;
    wrap.appendChild(chip);
  });

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'speakers-edit-btn';
  editBtn.textContent = '話者を編集';
  editBtn.addEventListener('click', async () => {
    const updated = await dialog.open(speakers);
    if (!updated) return;
    const allowedKeys = new Set(updated.map((sp) => sp.key));
    const node = editor.state.doc.nodeAt(interviewPos);
    if (!node) return;

    const removals: Array<{ from: number; to: number }> = [];
    let cursor = interviewPos + 1;
    node.forEach((turn) => {
      if (turn.type.name === 'turn' && !allowedKeys.has(turn.attrs.speaker)) {
        removals.push({ from: cursor, to: cursor + turn.nodeSize });
      }
      cursor += turn.nodeSize;
    });
    if (removals.length > 0) {
      const ok = window.confirm(
        `削除された話者の発言 ${removals.length} 件も同時に削除します。続行しますか?`,
      );
      if (!ok) return;
    }

    const tr = editor.state.tr;
    for (const r of removals.slice().reverse()) tr.delete(r.from, r.to);
    // speakers attr を更新 → NodeView.update() が再描画して avatar/name を反映
    tr.setNodeMarkup(interviewPos, undefined, { speakers: updated });

    // 残っている turn 全てに setNodeMarkup を打って NodeView.update() を強制的に呼び、
    // avatar/name を新しい speakers で再描画させる (attrs 自体は変えないので実質 no-op だが
    // NodeView 側の update フックが走る)。
    // 位置は setNodeMarkup(interview) 適用後の tr.doc を基準にする。
    const updatedInterview = tr.doc.nodeAt(interviewPos);
    if (updatedInterview) {
      let c = interviewPos + 1;
      updatedInterview.forEach((turn) => {
        if (turn.type.name === 'turn') {
          tr.setNodeMarkup(c, undefined, { speaker: turn.attrs.speaker });
        }
        c += turn.nodeSize;
      });
    }

    // 全 turn が消えた場合は A の空 turn を追加。
    const finalInterview = tr.doc.nodeAt(interviewPos);
    if (finalInterview && finalInterview.childCount === 0) {
      const turnType = editor.schema.nodes.turn;
      tr.insert(interviewPos + 1, turnType.create({ speaker: 'A' }));
    }
    editor.view.dispatch(tr);
  });
  wrap.appendChild(editBtn);

  // ブロックまるごと削除
  const deleteBlockBtn = document.createElement('button');
  deleteBlockBtn.type = 'button';
  deleteBlockBtn.className = 'interview-delete-btn';
  deleteBlockBtn.setAttribute('data-interview-delete', '1');
  deleteBlockBtn.textContent = 'ブロックを削除';
  deleteBlockBtn.title = 'このインタビューブロックを削除';
  deleteBlockBtn.addEventListener('click', () => {
    const node = editor.state.doc.nodeAt(interviewPos);
    if (!node || node.type.name !== 'interview') return;
    const ok = window.confirm('このインタビューブロックをまるごと削除します。よろしいですか?');
    if (!ok) return;
    const tr = editor.state.tr.delete(interviewPos, interviewPos + node.nodeSize);
    editor.view.dispatch(tr);
  });
  wrap.appendChild(deleteBlockBtn);

  return wrap;
}

// ==================== ＋発言を追加 ====================

function buildAddTurnButton(editor: Editor, interviewPos: number, speakers: Speaker[]): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'interview-block__add-turn';
  wrapper.contentEditable = 'false';
  wrapper.setAttribute('data-add-turn', '1');

  const label = document.createElement('span');
  label.className = 'add-turn__label';
  label.textContent = '＋ 発言を追加';
  wrapper.appendChild(label);

  speakers.forEach((s) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'add-turn__key';
    btn.innerHTML = `<span class="add-turn__k">${s.key}</span> ${escapeHtml(s.name || s.key)}`;
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
