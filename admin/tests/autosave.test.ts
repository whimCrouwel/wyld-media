// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createAutosave, saveDraftBackup, loadDraftBackup, clearDraftBackup,
} from '../src/lib/autosave';

beforeEach(() => localStorage.clear());

describe('draft backup (localStorage)', () => {
  it('round-trips body through save/load, keyed by article id', () => {
    const body = [{ type: 'paragraph', content: [{ type: 'text', text: '下書き' }] }];
    saveDraftBackup('article-1', body);
    const loaded = loadDraftBackup('article-1');
    expect(loaded).not.toBeNull();
    expect(loaded!.body).toEqual(body);
    expect(typeof loaded!.savedAt).toBe('string');
  });

  it('returns null when there is no backup for the id', () => {
    expect(loadDraftBackup('missing')).toBeNull();
  });

  it('clearDraftBackup removes the stored backup', () => {
    saveDraftBackup('article-2', []);
    clearDraftBackup('article-2');
    expect(loadDraftBackup('article-2')).toBeNull();
  });
});

describe('createAutosave', () => {
  it('skips saving when the snapshot body has not changed since the last save', async () => {
    const save = vi.fn(async () => ({ updatedAt: 'x' }));
    const body = [{ type: 'paragraph', content: [] }];
    const autosave = createAutosave({
      intervalMs: 1000,
      getSnapshot: () => ({ body, updatedAt: 't0' }),
      save, onSaved: () => {}, onConflict: () => {}, onError: () => {},
    });
    await autosave.triggerNow();
    await autosave.triggerNow();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('calls onConflict when save rejects with CONFLICT', async () => {
    const onConflict = vi.fn();
    const autosave = createAutosave({
      intervalMs: 1000,
      getSnapshot: () => ({ body: [{ type: 'paragraph' }], updatedAt: 't0' }),
      save: async () => { throw new Error('CONFLICT'); },
      onSaved: () => {}, onConflict, onError: () => {},
    });
    await autosave.triggerNow();
    expect(onConflict).toHaveBeenCalled();
  });
});
