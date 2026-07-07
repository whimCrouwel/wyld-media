import { describe, it, expect } from 'vitest';
import { validateLoginInput } from '../src/lib/auth';

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
