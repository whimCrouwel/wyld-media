import { describe, it, expect } from 'vitest';
import { validateLoginInput, validateResetEmail, translateAuthError, getRecoveryTokenHash, getAuthErrorMessageFromHash } from '../src/lib/auth';

describe('validateLoginInput', () => {
  it('returns null for a valid email + non-empty password', () => {
    expect(validateLoginInput('user@example.com', 'secret123')).toBeNull();
  });
  it('rejects an empty email', () => {
    expect(validateLoginInput('', 'secret123')).toMatch(/メール/);
  });
  it('rejects a malformed email', () => {
    expect(validateLoginInput('not-an-email', 'secret123')).toMatch(/メール/);
  });
  it('rejects an empty password', () => {
    expect(validateLoginInput('user@example.com', '')).toMatch(/パスワード/);
  });
});

describe('validateResetEmail', () => {
  it('returns null for a valid email', () => {
    expect(validateResetEmail('user@example.com')).toBeNull();
  });
  it('rejects an empty email', () => {
    expect(validateResetEmail('')).toMatch(/メール/);
  });
  it('rejects a malformed email', () => {
    expect(validateResetEmail('not-an-email')).toMatch(/メール/);
  });
});

describe('translateAuthError', () => {
  it('ログイン失敗を日本語にする', () => {
    expect(translateAuthError(new Error('Invalid login credentials')))
      .toBe('メールアドレスまたはパスワードが正しくありません。');
  });
  it('メール未確認を日本語にする', () => {
    expect(translateAuthError(new Error('Email not confirmed')))
      .toContain('未確認');
  });
  it('レート制限を日本語にする', () => {
    expect(translateAuthError(new Error('Rate limit exceeded'))).toContain('しばらく待って');
    expect(translateAuthError(new Error('For security purposes, you can only request this after 60 seconds.')))
      .toContain('しばらく待って');
  });
  it('パスワード不足を日本語にする', () => {
    expect(translateAuthError(new Error('Password should be at least 8 characters')))
      .toContain('8文字以上');
  });
  it('同一パスワードを日本語にする', () => {
    expect(translateAuthError(new Error('New password should be different from the old password.')))
      .toContain('同じパスワード');
  });
  it('セッション切れを日本語にする', () => {
    expect(translateAuthError(new Error('Auth session missing!'))).toContain('リンク');
  });
  it('未知のエラーは汎用メッセージ', () => {
    expect(translateAuthError(new Error('boom'))).toContain('エラーが発生しました');
    expect(translateAuthError(undefined)).toContain('エラーが発生しました');
  });
});

describe('getRecoveryTokenHash', () => {
  it('type=recovery の token_hash を取り出す', () => {
    expect(getRecoveryTokenHash('?token_hash=pkce_abc123&type=recovery')).toBe('pkce_abc123');
  });
  it('type が recovery 以外なら null', () => {
    expect(getRecoveryTokenHash('?token_hash=abc&type=invite')).toBeNull();
  });
  it('token_hash が無ければ null', () => {
    expect(getRecoveryTokenHash('?type=recovery')).toBeNull();
    expect(getRecoveryTokenHash('')).toBeNull();
  });
});

describe('getAuthErrorMessageFromHash', () => {
  it('otp_expired を期限切れメッセージにする', () => {
    expect(getAuthErrorMessageFromHash('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid'))
      .toContain('有効期限');
  });
  it('その他の error は汎用メッセージ', () => {
    expect(getAuthErrorMessageFromHash('#error=server_error&error_code=unexpected_failure'))
      .toContain('エラー');
  });
  it('エラーが無ければ null', () => {
    expect(getAuthErrorMessageFromHash('')).toBeNull();
    expect(getAuthErrorMessageFromHash('#access_token=xyz')).toBeNull();
  });
});
