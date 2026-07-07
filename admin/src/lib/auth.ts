// メール形式は「@ を含み前後に文字がある」程度の緩いチェック(最終検証は Supabase 側)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateLoginInput(email: string, password: string): string | null {
  if (!email || !EMAIL_RE.test(email)) {
    return 'メールアドレスを正しく入力してください';
  }
  if (!password) {
    return 'パスワードを入力してください';
  }
  return null;
}

export function redirectTo(path: string): void {
  window.location.assign(path);
}
