import { describe, it, expect } from 'vitest';
import { cn } from '../src/lib/cn';

describe('cn', () => {
  it('joins class strings with a space', () => {
    expect(cn('a', 'b', 'c')).toBe('a b c');
  });

  it('drops falsy values', () => {
    expect(cn('a', false, null, undefined, 'c')).toBe('a c');
  });

  it('returns an empty string when given nothing truthy', () => {
    expect(cn(false, null, undefined)).toBe('');
  });
});
