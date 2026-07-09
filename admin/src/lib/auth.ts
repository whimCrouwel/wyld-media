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

// GoTrue の代表的なエラーメッセージを日本語へ。未知のものは汎用文言に落とす。
export function translateAuthError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (msg.includes('Invalid login credentials')) {
    return 'メールアドレスまたはパスワードが正しくありません。';
  }
  if (msg.includes('Email not confirmed')) {
    return 'メールアドレスが未確認です。招待メールのリンクから開いてください。';
  }
  if (msg.toLowerCase().includes('rate limit') || msg.includes('you can only request this after')) {
    return '試行回数が多すぎます。しばらく待ってから再度お試しください。';
  }
  if (msg.includes('Password should be at least')) {
    return 'パスワードが短すぎます。8文字以上にしてください。';
  }
  if (msg.includes('New password should be different')) {
    return '現在と同じパスワードは設定できません。';
  }
  if (msg.includes('Auth session missing')) {
    return 'セッションが切れています。招待リンクをもう一度開いてください。';
  }
  return 'エラーが発生しました。時間をおいて再度お試しください。';
}
