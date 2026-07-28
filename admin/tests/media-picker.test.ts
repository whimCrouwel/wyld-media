// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { initMediaPicker } from '../src/lib/media-picker';
import * as media from '../src/lib/media';

const ITEM = {
  id: 'm1', url: 'https://img.test/uid/a.webp', bytes: 1000,
  createdAt: '2026-07-09T00:00:00Z',
};

function setup() {
  document.body.innerHTML = `
    <div id="media-modal" hidden>
      <div id="media-grid"></div>
      <p id="media-status"></p>
      <button id="media-close">閉じる</button>
    </div>
  `;
  return {
    modalEl: document.getElementById('media-modal') as HTMLElement,
    gridEl: document.getElementById('media-grid') as HTMLElement,
    statusEl: document.getElementById('media-status') as HTMLElement,
    closeBtn: document.getElementById('media-close') as HTMLButtonElement,
  };
}

const supabase = {} as SupabaseClient;

describe('initMediaPicker', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('open で一覧を描画する', async () => {
    vi.spyOn(media, 'listMyMedia').mockResolvedValue([ITEM]);
    const els = setup();
    const picker = initMediaPicker(supabase, { ...els, onPick: () => {} });

    await picker.open();

    expect(els.modalEl.hidden).toBe(false);
    const img = els.gridEl.querySelector('img')!;
    expect(img.src).toBe(ITEM.url);
  });

  it('画像を押すと onPick が呼ばれモーダルが閉じる', async () => {
    vi.spyOn(media, 'listMyMedia').mockResolvedValue([ITEM]);
    const els = setup();
    const onPick = vi.fn();
    const picker = initMediaPicker(supabase, { ...els, onPick });

    await picker.open();
    (els.gridEl.querySelector('button[data-role="pick"]') as HTMLButtonElement).click();

    expect(onPick).toHaveBeenCalledWith(ITEM.url);
    expect(els.modalEl.hidden).toBe(true);
  });

  it('open に onPick 上書きを渡すとその回だけ差し替わり、次回は既定に戻る', async () => {
    vi.spyOn(media, 'listMyMedia').mockResolvedValue([ITEM]);
    const els = setup();
    const defaultPick = vi.fn();
    const override = vi.fn();
    const picker = initMediaPicker(supabase, { ...els, onPick: defaultPick });

    await picker.open(override);
    (els.gridEl.querySelector('button[data-role="pick"]') as HTMLButtonElement).click();
    expect(override).toHaveBeenCalledWith(ITEM.url);
    expect(defaultPick).not.toHaveBeenCalled();

    await picker.open();
    (els.gridEl.querySelector('button[data-role="pick"]') as HTMLButtonElement).click();
    expect(defaultPick).toHaveBeenCalledWith(ITEM.url);
    expect(override).toHaveBeenCalledOnce();
  });

  it('削除は2クリック必要', async () => {
    vi.spyOn(media, 'listMyMedia').mockResolvedValue([ITEM]);
    const del = vi.spyOn(media, 'deleteMedia').mockResolvedValue(undefined);
    const els = setup();
    const picker = initMediaPicker(supabase, { ...els, onPick: () => {} });

    await picker.open();
    const btn = els.gridEl.querySelector('button[data-role="delete"]') as HTMLButtonElement;
    btn.click();
    expect(del).not.toHaveBeenCalled();
    expect(btn.textContent).toContain('もう一度');

    btn.click();
    await vi.waitFor(() => expect(del).toHaveBeenCalledOnce());
  });

  it('使用中なら日本語のエラーを出す', async () => {
    vi.spyOn(media, 'listMyMedia').mockResolvedValue([ITEM]);
    vi.spyOn(media, 'deleteMedia').mockRejectedValue(new Error('MEDIA_IN_USE'));
    const els = setup();
    const picker = initMediaPicker(supabase, { ...els, onPick: () => {} });

    await picker.open();
    const btn = els.gridEl.querySelector('button[data-role="delete"]') as HTMLButtonElement;
    btn.click();
    btn.click();

    await vi.waitFor(() => expect(els.statusEl.textContent).toContain('使われて'));
  });

  it('画像が無ければその旨を出す', async () => {
    vi.spyOn(media, 'listMyMedia').mockResolvedValue([]);
    const els = setup();
    const picker = initMediaPicker(supabase, { ...els, onPick: () => {} });

    await picker.open();
    expect(els.statusEl.textContent).toContain('まだ画像がありません');
  });
});
