import type { SupabaseClient } from '@supabase/supabase-js';
import { uploadAndRecord } from './body-image';

export type Speaker = {
  key: 'A' | 'B' | 'C' | 'D';
  name: string;
  role: string;
  avatarUrl: string;
};

export interface InterviewDialogController {
  open(initial?: Speaker[]): Promise<Speaker[] | null>;
}

export interface InterviewDialogOptions {
  modalEl: HTMLElement;
  formEl: HTMLElement;
  addBtn: HTMLButtonElement;
  saveBtn: HTMLButtonElement;
  cancelBtn: HTMLButtonElement;
  myProfile: { name: string; avatarUrl: string | null } | null;
  imageBaseUrl: string;
}

const KEYS: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D'];
const MIN_SPEAKERS = 2;
const MAX_SPEAKERS = 4;

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function emptySpeaker(key: Speaker['key']): Speaker {
  return { key, name: '', role: '', avatarUrl: '' };
}

// initMediaPicker (media-picker.ts) と同じく、hidden 切替型のモーダルコントローラ。
// <dialog> 要素は使わず、既存モーダルの流儀 (modalEl.hidden = true|false) に揃える。
export function initInterviewDialog(
  supabase: SupabaseClient,
  opts: InterviewDialogOptions,
): InterviewDialogController {
  const { modalEl, formEl, addBtn, saveBtn, cancelBtn, myProfile, imageBaseUrl } = opts;
  let currentResolve: ((v: Speaker[] | null) => void) | null = null;
  let workingSpeakers: Speaker[] = [];
  // プロフィール画像が settings.image_base_url 配下でないと DB トリガーで IMAGE_HOST_NOT_ALLOWED になる。
  // ボタンは表示するが disable し、なぜ使えないかを title で伝える(profile を更新すれば直ることが分かるように)。
  const profileAvatarUsable = !!myProfile?.avatarUrl && myProfile.avatarUrl.startsWith(imageBaseUrl);

  function render(): void {
    formEl.replaceChildren();
    workingSpeakers.forEach((s, idx) => {
      const isTail = idx === workingSpeakers.length - 1;
      // A/B (idx 0, 1) は常に必須で削除不可。削除できるのは末尾の C/D のみ。
      const isRemovable = idx >= MIN_SPEAKERS && isTail;
      const card = document.createElement('div');
      card.setAttribute('data-speaker-card', s.key);
      card.className = 'speaker-card';
      card.innerHTML = `
        <div class="speaker-card__header">
          <span class="speaker-card__key">話者 ${s.key}</span>
          ${isRemovable
            ? `<button type="button" data-remove-speaker="${s.key}" class="speaker-card__remove" aria-label="話者 ${s.key} を削除">削除</button>`
            : (idx < MIN_SPEAKERS ? '<span class="speaker-card__badge">必須</span>' : '')}
        </div>
        <div class="speaker-card__avatar-row">
          ${s.avatarUrl
            ? `<img src="${escapeAttr(s.avatarUrl)}" alt="${escapeAttr(s.name)}" class="speaker-card__avatar" />`
            : '<div class="speaker-card__avatar speaker-card__avatar--placeholder">画像</div>'}
          <div class="speaker-card__avatar-actions">
            <label class="speaker-card__upload">
              画像をアップロード
              <input type="file" accept="image/*" data-upload-avatar="${s.key}" hidden />
            </label>
            ${myProfile?.avatarUrl
              ? (profileAvatarUsable
                  ? `<button type="button" data-use-profile="${s.key}" class="speaker-card__link-btn">自分のプロフィール画像を使う</button>`
                  : `<button type="button" class="speaker-card__link-btn" disabled title="プロフィール画像が許可されたホストにないため使えません。プロフィール画面から画像を再アップロードしてください。">自分のプロフィール画像を使う</button>`)
              : ''}
            ${s.avatarUrl ? `<button type="button" data-clear-avatar="${s.key}" class="speaker-card__link-btn">画像を削除</button>` : ''}
          </div>
        </div>
        <label class="speaker-card__field">
          <span>名前 <em>*</em></span>
          <input type="text" name="name" value="${escapeAttr(s.name)}" class="speaker-card__input" required />
        </label>
        <label class="speaker-card__field">
          <span>肩書</span>
          <input type="text" name="role" value="${escapeAttr(s.role)}" placeholder="Kaeru Design 代表" class="speaker-card__input" />
        </label>
      `;
      formEl.appendChild(card);
    });
    addBtn.disabled = workingSpeakers.length >= MAX_SPEAKERS;
  }

  function readFromDom(): void {
    workingSpeakers = workingSpeakers.map((s) => {
      const card = formEl.querySelector(`[data-speaker-card="${s.key}"]`) as HTMLElement | null;
      if (!card) return s;
      const name = (card.querySelector('[name="name"]') as HTMLInputElement).value.trim();
      const role = (card.querySelector('[name="role"]') as HTMLInputElement).value.trim();
      return { ...s, name, role };
    });
  }

  function validate(): boolean {
    let ok = true;
    for (const s of workingSpeakers) {
      const card = formEl.querySelector(`[data-speaker-card="${s.key}"]`) as HTMLElement | null;
      if (!card) continue;
      const nameInput = card.querySelector('[name="name"]') as HTMLInputElement;
      if (!s.name) {
        nameInput.setAttribute('aria-invalid', 'true');
        ok = false;
      } else {
        nameInput.removeAttribute('aria-invalid');
      }
    }
    return ok;
  }

  formEl.addEventListener('input', (e) => {
    const target = e.target as HTMLElement;
    if (target.hasAttribute('name')) {
      target.removeAttribute('aria-invalid');
    }
  });

  formEl.addEventListener('change', async (e) => {
    const target = e.target as HTMLInputElement;
    const uploadKey = target.getAttribute('data-upload-avatar');
    if (uploadKey && target.files?.[0]) {
      readFromDom();
      const file = target.files[0];
      try {
        const url = await uploadAndRecord(supabase, file);
        const idx = workingSpeakers.findIndex((s) => s.key === uploadKey);
        if (idx >= 0) workingSpeakers[idx].avatarUrl = url;
        render();
      } catch (err) {
        window.alert(`アップロード失敗: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  });

  formEl.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const removeKey = target.getAttribute('data-remove-speaker');
    const useProfileKey = target.getAttribute('data-use-profile');
    const clearKey = target.getAttribute('data-clear-avatar');
    if (removeKey) {
      readFromDom();
      const idx = workingSpeakers.findIndex((s) => s.key === removeKey);
      // 末尾かつ C/D のみ削除可 (A/B は常に必須)。
      if (idx >= MIN_SPEAKERS && idx === workingSpeakers.length - 1) {
        workingSpeakers.splice(idx, 1);
        render();
      }
    } else if (useProfileKey && myProfile?.avatarUrl && profileAvatarUsable) {
      readFromDom();
      const idx = workingSpeakers.findIndex((s) => s.key === useProfileKey);
      if (idx >= 0) {
        workingSpeakers[idx].avatarUrl = myProfile.avatarUrl;
        if (!workingSpeakers[idx].name) workingSpeakers[idx].name = myProfile.name;
        render();
      }
    } else if (clearKey) {
      readFromDom();
      const idx = workingSpeakers.findIndex((s) => s.key === clearKey);
      if (idx >= 0) {
        workingSpeakers[idx].avatarUrl = '';
        render();
      }
    }
  });

  addBtn.addEventListener('click', () => {
    if (workingSpeakers.length >= MAX_SPEAKERS) return;
    readFromDom();
    const newKey = KEYS[workingSpeakers.length];
    workingSpeakers.push(emptySpeaker(newKey));
    render();
  });

  cancelBtn.addEventListener('click', () => {
    modalEl.hidden = true;
    if (currentResolve) {
      currentResolve(null);
      currentResolve = null;
    }
  });

  saveBtn.addEventListener('click', () => {
    readFromDom();
    if (!validate()) return;
    modalEl.hidden = true;
    if (currentResolve) {
      currentResolve(structuredClone(workingSpeakers));
      currentResolve = null;
    }
  });

  // 新規インタビュー時の話者 A のデフォルト。A は聞き手(=ライター本人)なので、
  // 名前・肩書き・(使えるなら)プロフィール画像をあらかじめセットしておく。
  // profile が無い匿名操作時は空 A で開く。
  function defaultSpeakerA(): Speaker {
    if (!myProfile) return emptySpeaker('A');
    return {
      key: 'A',
      name: myProfile.name || '',
      role: '聞き手',
      avatarUrl: profileAvatarUsable ? (myProfile.avatarUrl ?? '') : '',
    };
  }

  return {
    open(initial?: Speaker[]) {
      workingSpeakers = initial && initial.length > 0
        ? structuredClone(initial)
        : [defaultSpeakerA(), emptySpeaker('B')];
      render();
      modalEl.hidden = false;
      return new Promise<Speaker[] | null>((resolve) => {
        currentResolve = resolve;
      });
    },
  };
}
