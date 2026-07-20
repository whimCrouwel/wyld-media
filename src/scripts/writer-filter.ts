// ライター一覧のエリア絞り込み。全ライターは静的ビルド時に出力済みなので、
// ここでは行の表示/非表示を切り替えるだけ(再フェッチも遷移もしない)。
const filter = document.getElementById('region-filter');
const list = document.getElementById('writer-list');
const count = document.getElementById('writer-count');

if (filter && list && count) {
  const buttons = [...filter.querySelectorAll<HTMLButtonElement>('button[data-region]')];
  const rows = [...list.querySelectorAll<HTMLElement>('li[data-region]')];

  const apply = (selected: string) => {
    let visible = 0;
    for (const row of rows) {
      const match = selected === '' || row.dataset.region === selected;
      row.hidden = !match;
      if (match) visible += 1;
    }
    count.textContent = String(visible).padStart(2, '0');
    for (const button of buttons) {
      const active = button.dataset.region === selected;
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('is-active', active);
    }
  };

  for (const button of buttons) {
    button.addEventListener('click', () => apply(button.dataset.region ?? ''));
  }
}
