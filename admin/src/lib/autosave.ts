import type { JSONContent } from '@tiptap/core';

export interface AutosaveSnapshot {
  body: JSONContent[];
  updatedAt: string;
}

export interface AutosaveOptions {
  intervalMs: number;
  getSnapshot: () => AutosaveSnapshot;
  save: (body: JSONContent[], expectedUpdatedAt: string) => Promise<{ updatedAt: string }>;
  onSaved: (updatedAt: string) => void;
  onConflict: () => void;
  onError: (err: unknown) => void;
}

export interface AutosaveController {
  start(): void;
  stop(): void;
  triggerNow(): Promise<void>;
}

export function createAutosave(opts: AutosaveOptions): AutosaveController {
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;
  let lastSavedBody: string | null = null;

  const run = async () => {
    if (inFlight) return;
    const snapshot = opts.getSnapshot();
    const serialized = JSON.stringify(snapshot.body);
    if (serialized === lastSavedBody) return;
    inFlight = true;
    try {
      const result = await opts.save(snapshot.body, snapshot.updatedAt);
      lastSavedBody = serialized;
      opts.onSaved(result.updatedAt);
    } catch (err) {
      if (err instanceof Error && err.message === 'CONFLICT') {
        opts.onConflict();
      } else {
        opts.onError(err);
      }
    } finally {
      inFlight = false;
    }
  };

  return {
    start() {
      if (timer) return;
      timer = setInterval(run, opts.intervalMs);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    triggerNow: run,
  };
}

const backupKey = (articleId: string) => `wild-media:draft-backup:${articleId}`;

export function saveDraftBackup(articleId: string, body: JSONContent[]): void {
  localStorage.setItem(
    backupKey(articleId),
    JSON.stringify({ body, savedAt: new Date().toISOString() }),
  );
}

export function loadDraftBackup(
  articleId: string,
): { body: JSONContent[]; savedAt: string } | null {
  const raw = localStorage.getItem(backupKey(articleId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { body: JSONContent[]; savedAt: string };
  } catch {
    return null;
  }
}

export function clearDraftBackup(articleId: string): void {
  localStorage.removeItem(backupKey(articleId));
}
