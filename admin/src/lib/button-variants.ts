// Button.astro のバリアント定義。ページスクリプトから実行時にバリアントを
// 差し替えるケース(記事編集画面の状態依存ボタン等)と単一ソースを共有する。
export type ButtonVariant = 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'default' | 'lg' | 'icon';

export const buttonBase =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50';

export const buttonVariants: Record<ButtonVariant, string> = {
  default: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
  ghost: 'hover:bg-accent hover:text-accent-foreground',
  destructive: 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
};

export const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-9 rounded-md px-3',
  default: 'h-10 px-4 py-2',
  lg: 'h-11 rounded-md px-8',
  icon: 'h-10 w-10',
};

export function setButtonVariant(btn: HTMLElement, variant: ButtonVariant): void {
  for (const classes of Object.values(buttonVariants)) {
    btn.classList.remove(...classes.split(' '));
  }
  btn.classList.add(...buttonVariants[variant].split(' '));
}
