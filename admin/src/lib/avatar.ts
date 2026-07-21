export interface AvatarViewModel {
  src: string | null;
  alt: string;
  initial: string;
}

// 純粋関数: 表示内容の決定のみ(DOM に触れない → 単体テスト対象)
export function toAvatarViewModel(name: string, avatarUrl: string | null): AvatarViewModel {
  const trimmed = name.trim();
  return {
    src: avatarUrl,
    alt: trimmed,
    initial: trimmed.charAt(0) || '?',
  };
}

// DOM 反映: Avatar.astro のシェル([data-avatar-img]/[data-avatar-fallback])に対する適用のみ
export function applyAvatar(container: HTMLElement, vm: AvatarViewModel): void {
  const img = container.querySelector<HTMLImageElement>('[data-avatar-img]');
  const fallback = container.querySelector<HTMLElement>('[data-avatar-fallback]');
  if (!img || !fallback) return;
  if (vm.src) {
    img.src = vm.src;
    img.alt = vm.alt;
    img.classList.remove('hidden');
    fallback.classList.add('hidden');
  } else {
    img.classList.add('hidden');
    fallback.textContent = vm.initial;
    fallback.classList.remove('hidden');
  }
}
