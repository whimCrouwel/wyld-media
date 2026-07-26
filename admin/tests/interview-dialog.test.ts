// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { initInterviewDialog } from '../src/lib/interview-dialog';

function setup() {
  document.body.innerHTML = `
    <div id="interview-modal" hidden>
      <form id="interview-form"></form>
      <button id="interview-add" type="button">＋話者を追加</button>
      <button id="interview-save" type="button">決定</button>
      <button id="interview-cancel" type="button">キャンセル</button>
    </div>
  `;
  return {
    modalEl: document.getElementById('interview-modal') as HTMLElement,
    formEl: document.getElementById('interview-form') as HTMLElement,
    addBtn: document.getElementById('interview-add') as HTMLButtonElement,
    saveBtn: document.getElementById('interview-save') as HTMLButtonElement,
    cancelBtn: document.getElementById('interview-cancel') as HTMLButtonElement,
  };
}

const fakeSupabase = {} as SupabaseClient;

describe('initInterviewDialog', () => {
  it('opens with 2 empty speakers (A, B) when no initial provided', async () => {
    const { modalEl, formEl, addBtn, saveBtn, cancelBtn } = setup();
    const dialog = initInterviewDialog(fakeSupabase, {
      modalEl, formEl, addBtn, saveBtn, cancelBtn, myProfile: null,
    });
    const pending = dialog.open();
    expect(modalEl.hidden).toBe(false);
    expect(formEl.querySelectorAll('[data-speaker-card]').length).toBe(2);
    cancelBtn.click();
    const result = await pending;
    expect(result).toBeNull();
  });

  it('populates from initial and resolves with edited speakers on save', async () => {
    const { modalEl, formEl, addBtn, saveBtn, cancelBtn } = setup();
    const dialog = initInterviewDialog(fakeSupabase, {
      modalEl, formEl, addBtn, saveBtn, cancelBtn, myProfile: null,
    });
    const initial = [
      { key: 'A' as const, name: '米田', role: '聞き手', avatarUrl: 'https://img.test/a.webp' },
      { key: 'B' as const, name: '川崎', role: 'Kaeru', avatarUrl: 'https://img.test/b.webp' },
    ];
    const pending = dialog.open(initial);
    const nameA = formEl.querySelector('[data-speaker-card="A"] [name="name"]') as HTMLInputElement;
    expect(nameA.value).toBe('米田');
    nameA.value = '米田 貴明';
    saveBtn.click();
    const result = await pending;
    expect(result).not.toBeNull();
    expect(result![0].name).toBe('米田 貴明');
    expect(result![1].name).toBe('川崎');
  });

  it('adds and removes speakers up to 4, always tail-only', () => {
    const { modalEl, formEl, addBtn, saveBtn, cancelBtn } = setup();
    const dialog = initInterviewDialog(fakeSupabase, {
      modalEl, formEl, addBtn, saveBtn, cancelBtn, myProfile: null,
    });
    dialog.open();
    expect(formEl.querySelectorAll('[data-speaker-card]').length).toBe(2);
    addBtn.click(); // -> 3
    expect(formEl.querySelectorAll('[data-speaker-card]').length).toBe(3);
    addBtn.click(); // -> 4
    expect(formEl.querySelectorAll('[data-speaker-card]').length).toBe(4);
    addBtn.click(); // -> 4 (upper cap)
    expect(formEl.querySelectorAll('[data-speaker-card]').length).toBe(4);
    // 削除ボタンは末尾 (D) のみ表示
    const removeButtons = formEl.querySelectorAll('[data-remove-speaker]');
    expect(removeButtons.length).toBe(1);
    expect(removeButtons[0].getAttribute('data-remove-speaker')).toBe('D');
    (removeButtons[0] as HTMLButtonElement).click(); // -> 3, C が末尾
    expect(formEl.querySelectorAll('[data-speaker-card]').length).toBe(3);
    expect(formEl.querySelector('[data-remove-speaker]')?.getAttribute('data-remove-speaker')).toBe('C');
  });

  it('rejects save with empty name and marks the field', () => {
    const { modalEl, formEl, addBtn, saveBtn, cancelBtn } = setup();
    const dialog = initInterviewDialog(fakeSupabase, {
      modalEl, formEl, addBtn, saveBtn, cancelBtn, myProfile: null,
    });
    dialog.open();
    saveBtn.click();
    expect(modalEl.hidden).toBe(false); // 閉じない
    const nameA = formEl.querySelector('[data-speaker-card="A"] [name="name"]') as HTMLInputElement;
    expect(nameA.getAttribute('aria-invalid')).toBe('true');
  });
});
