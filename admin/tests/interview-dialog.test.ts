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
      imageBaseUrl: 'https://img.test/',
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
      imageBaseUrl: 'https://img.test/',
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
      imageBaseUrl: 'https://img.test/',
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

  it('disables "use profile" button when profile avatar host is not allowed', () => {
    const { modalEl, formEl, addBtn, saveBtn, cancelBtn } = setup();
    const dialog = initInterviewDialog(fakeSupabase, {
      modalEl, formEl, addBtn, saveBtn, cancelBtn,
      myProfile: { name: '米田', avatarUrl: 'https://picsum.photos/200' },
      imageBaseUrl: 'https://img.test/',
    });
    dialog.open();
    const btn = formEl.querySelector('[data-speaker-card="A"] button.speaker-card__link-btn') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(true);
    expect(btn.hasAttribute('data-use-profile')).toBe(false);
  });

  it('enables "use profile" button when profile avatar host matches image_base_url', () => {
    const { modalEl, formEl, addBtn, saveBtn, cancelBtn } = setup();
    const dialog = initInterviewDialog(fakeSupabase, {
      modalEl, formEl, addBtn, saveBtn, cancelBtn,
      myProfile: { name: '米田', avatarUrl: 'https://img.test/me.webp' },
      imageBaseUrl: 'https://img.test/',
    });
    dialog.open();
    const btn = formEl.querySelector('[data-speaker-card="A"] [data-use-profile="A"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(false);
    btn.click();
    const avatar = formEl.querySelector('[data-speaker-card="A"] img.speaker-card__avatar') as HTMLImageElement;
    expect(avatar.src).toBe('https://img.test/me.webp');
  });

  it('pre-fills speaker A with writer name + role "聞き手" + usable profile avatar on fresh open', async () => {
    const { modalEl, formEl, addBtn, saveBtn, cancelBtn } = setup();
    const dialog = initInterviewDialog(fakeSupabase, {
      modalEl, formEl, addBtn, saveBtn, cancelBtn,
      myProfile: { name: '田中 花', avatarUrl: 'https://img.test/hana.webp' },
      imageBaseUrl: 'https://img.test/',
    });
    const pending = dialog.open();
    const nameA = formEl.querySelector('[data-speaker-card="A"] [name="name"]') as HTMLInputElement;
    const roleA = formEl.querySelector('[data-speaker-card="A"] [name="role"]') as HTMLInputElement;
    const avatarA = formEl.querySelector('[data-speaker-card="A"] img.speaker-card__avatar') as HTMLImageElement;
    expect(nameA.value).toBe('田中 花');
    expect(roleA.value).toBe('聞き手');
    expect(avatarA?.src).toBe('https://img.test/hana.webp');
    // B は空のまま
    const nameB = formEl.querySelector('[data-speaker-card="B"] [name="name"]') as HTMLInputElement;
    expect(nameB.value).toBe('');
    // save のためだけに B にも名前を入れる (validate 通過用)
    nameB.value = 'ゲスト';
    saveBtn.click();
    const result = await pending;
    expect(result?.[0].name).toBe('田中 花');
    expect(result?.[0].role).toBe('聞き手');
    expect(result?.[0].avatarUrl).toBe('https://img.test/hana.webp');
  });

  it('pre-fills speaker A with name + role but empty avatar when profile avatar host is not allowed', () => {
    const { modalEl, formEl, addBtn, saveBtn, cancelBtn } = setup();
    const dialog = initInterviewDialog(fakeSupabase, {
      modalEl, formEl, addBtn, saveBtn, cancelBtn,
      myProfile: { name: '田中 花', avatarUrl: 'https://picsum.photos/200' },
      imageBaseUrl: 'https://img.test/',
    });
    dialog.open();
    const nameA = formEl.querySelector('[data-speaker-card="A"] [name="name"]') as HTMLInputElement;
    const roleA = formEl.querySelector('[data-speaker-card="A"] [name="role"]') as HTMLInputElement;
    expect(nameA.value).toBe('田中 花');
    expect(roleA.value).toBe('聞き手');
    // avatar は placeholder のまま (画像なし)
    expect(formEl.querySelector('[data-speaker-card="A"] img.speaker-card__avatar')).toBeNull();
    expect(formEl.querySelector('[data-speaker-card="A"] .speaker-card__avatar--placeholder')).not.toBeNull();
  });

  it('does NOT override initial speakers with profile defaults when editing existing interview', () => {
    const { modalEl, formEl, addBtn, saveBtn, cancelBtn } = setup();
    const dialog = initInterviewDialog(fakeSupabase, {
      modalEl, formEl, addBtn, saveBtn, cancelBtn,
      myProfile: { name: '田中 花', avatarUrl: 'https://img.test/hana.webp' },
      imageBaseUrl: 'https://img.test/',
    });
    dialog.open([
      { key: 'A', name: '既存A', role: '既存肩書き', avatarUrl: '' },
      { key: 'B', name: '既存B', role: '', avatarUrl: '' },
    ]);
    const nameA = formEl.querySelector('[data-speaker-card="A"] [name="name"]') as HTMLInputElement;
    const roleA = formEl.querySelector('[data-speaker-card="A"] [name="role"]') as HTMLInputElement;
    expect(nameA.value).toBe('既存A');
    expect(roleA.value).toBe('既存肩書き');
  });

  it('does not render the library-pick button when pickFromLibrary is not provided', () => {
    const { modalEl, formEl, addBtn, saveBtn, cancelBtn } = setup();
    const dialog = initInterviewDialog(fakeSupabase, {
      modalEl, formEl, addBtn, saveBtn, cancelBtn, myProfile: null,
      imageBaseUrl: 'https://img.test/',
    });
    dialog.open();
    expect(formEl.querySelector('[data-pick-library="A"]')).toBeNull();
  });

  it('sets the avatar to the picked library URL and re-renders', () => {
    const { modalEl, formEl, addBtn, saveBtn, cancelBtn } = setup();
    const dialog = initInterviewDialog(fakeSupabase, {
      modalEl, formEl, addBtn, saveBtn, cancelBtn, myProfile: null,
      imageBaseUrl: 'https://img.test/',
      pickFromLibrary: (onPick) => onPick('https://img.test/from-library.webp'),
    });
    dialog.open();
    const pickBtn = formEl.querySelector('[data-pick-library="A"]') as HTMLButtonElement;
    expect(pickBtn).not.toBeNull();
    pickBtn.click();
    const avatar = formEl.querySelector('[data-speaker-card="A"] img.speaker-card__avatar') as HTMLImageElement;
    expect(avatar.src).toBe('https://img.test/from-library.webp');
  });

  it('preserves edited name/role when picking from the library mid-edit', () => {
    const { modalEl, formEl, addBtn, saveBtn, cancelBtn } = setup();
    let capturedPick: ((url: string) => void) | null = null;
    const dialog = initInterviewDialog(fakeSupabase, {
      modalEl, formEl, addBtn, saveBtn, cancelBtn, myProfile: null,
      imageBaseUrl: 'https://img.test/',
      pickFromLibrary: (onPick) => { capturedPick = onPick; },
    });
    dialog.open();
    const nameA = formEl.querySelector('[data-speaker-card="A"] [name="name"]') as HTMLInputElement;
    nameA.value = '編集中の名前';
    (formEl.querySelector('[data-pick-library="A"]') as HTMLButtonElement).click();
    capturedPick!('https://img.test/picked.webp');
    const avatar = formEl.querySelector('[data-speaker-card="A"] img.speaker-card__avatar') as HTMLImageElement;
    expect(avatar.src).toBe('https://img.test/picked.webp');
    const nameAAfter = formEl.querySelector('[data-speaker-card="A"] [name="name"]') as HTMLInputElement;
    expect(nameAAfter.value).toBe('編集中の名前');
  });

  it('rejects save with empty name and marks the field', () => {
    const { modalEl, formEl, addBtn, saveBtn, cancelBtn } = setup();
    const dialog = initInterviewDialog(fakeSupabase, {
      modalEl, formEl, addBtn, saveBtn, cancelBtn, myProfile: null,
      imageBaseUrl: 'https://img.test/',
    });
    dialog.open();
    saveBtn.click();
    expect(modalEl.hidden).toBe(false); // 閉じない
    const nameA = formEl.querySelector('[data-speaker-card="A"] [name="name"]') as HTMLInputElement;
    expect(nameA.getAttribute('aria-invalid')).toBe('true');
  });
});
