import { describe, it, expect } from 'vitest';
import { filterCommands, type BlockCommand } from '../src/lib/insert-menu';

const commands: BlockCommand[] = [
  { id: 'heading', label: '見出し', run: () => {} },
  { id: 'image', label: '画像を挿入', run: () => {} },
  { id: 'quote', label: '引用', run: () => {} },
];

describe('filterCommands', () => {
  it('returns all commands for an empty query', () => {
    expect(filterCommands(commands, '')).toHaveLength(3);
  });
  it('filters by label substring', () => {
    expect(filterCommands(commands, '画像').map((c) => c.id)).toEqual(['image']);
  });
  it('filters by id substring (english query)', () => {
    expect(filterCommands(commands, 'quo').map((c) => c.id)).toEqual(['quote']);
  });
  it('returns empty array when nothing matches', () => {
    expect(filterCommands(commands, 'zzz')).toEqual([]);
  });
});
