export interface SlashCommand {
  id: string;
  label: string;
  run(): void | Promise<void>;
}

// キャレットの直前が「行頭の / + 空白なしの文字列」なら検索語を返す。
// 行の途中の / (URL の https:// など)では開かない。
export function matchSlashQuery(textBeforeCaret: string): string | null {
  const m = textBeforeCaret.match(/(?:^|\n)\/([^\s\n]*)$/);
  return m ? m[1] : null;
}

export function initSlashMenu(
  textarea: HTMLTextAreaElement,
  menuEl: HTMLElement,
  commands: SlashCommand[],
): void {
  let visible: SlashCommand[] = [];
  let activeIndex = 0;
  let query: string | null = null;

  const close = () => {
    query = null;
    visible = [];
    activeIndex = 0;
    menuEl.hidden = true;
    menuEl.replaceChildren();
  };

  // 「/検索語」をキャレットの手前から取り除く。run() が本文を触る前に消す。
  const removeQuery = () => {
    if (query === null) return;
    const caret = textarea.selectionStart;
    const start = caret - (query.length + 1);
    textarea.value = textarea.value.slice(0, start) + textarea.value.slice(caret);
    textarea.selectionStart = start;
    textarea.selectionEnd = start;
  };

  const select = (cmd: SlashCommand) => {
    removeQuery();
    close();
    textarea.focus();
    void cmd.run();
  };

  const render = () => {
    menuEl.replaceChildren();
    visible.forEach((cmd, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = cmd.label; // ユーザー入力ではないが innerHTML は使わない
      btn.setAttribute('aria-selected', String(i === activeIndex));
      // mousedown で処理する: click だと先に textarea が blur してキャレットが失われる
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        select(cmd);
      });
      menuEl.append(btn);
    });
    menuEl.hidden = visible.length === 0;
  };

  textarea.addEventListener('input', () => {
    const before = textarea.value.slice(0, textarea.selectionStart);
    query = matchSlashQuery(before);
    if (query === null) {
      close();
      return;
    }
    const q = query.toLowerCase();
    visible = commands.filter((c) => c.label.toLowerCase().includes(q));
    activeIndex = 0;
    if (visible.length === 0) {
      close();
      return;
    }
    render();
  });

  textarea.addEventListener('keydown', (e) => {
    if (menuEl.hidden) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % visible.length;
      render();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + visible.length) % visible.length;
      render();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      select(visible[activeIndex]);
    }
  });

  textarea.addEventListener('blur', () => {
    // mousedown で選択済みなので、ここで閉じても取りこぼさない
    close();
  });
}
