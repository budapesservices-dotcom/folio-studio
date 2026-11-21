import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDebouncedAutosave,
  setRevisionFencedAutosaveStatus,
} from '../src/app/debouncedAutosave';

afterEach(() => vi.useRealTimers());

describe('Main Canvas autosave status revision fence', () => {
  it('does not let a delayed old save callback overwrite the newer revision saving status', async () => {
    let canonicalRevision = 8;
    let status: 'saving' | 'saved' | 'error' = 'saving';
    const history: string[] = ['saving'];
    let releaseCallback!: () => void;
    const callbackGate = new Promise<void>((resolve) => { releaseCallback = resolve; });

    const completedTransaction = Promise.resolve({ status: 'saved' as const });
    const delayedCallback = completedTransaction.then(async (result) => {
      await callbackGate;
      if (result.status === 'saved') {
        setRevisionFencedAutosaveStatus(
          8,
          () => canonicalRevision,
          'saved',
          (next) => { status = next; history.push(next); },
        );
      }
    });

    canonicalRevision = 9;
    status = 'saving';
    history.push('saving');
    releaseCallback();
    await delayedCallback;

    expect(status).toBe('saving');
    expect(history).toEqual(['saving', 'saving']);
  });

  it('does not let a delayed persistence error overwrite a newer revision status', () => {
    let canonicalRevision = 20;
    let status: 'saving' | 'saved' | 'error' = 'saving';

    canonicalRevision = 21;
    const applied = setRevisionFencedAutosaveStatus(
      20,
      () => canonicalRevision,
      'error',
      (next) => { status = next; },
    );

    expect(applied).toBe(false);
    expect(status).toBe('saving');
  });
});

describe('Component Canvas autosave ordering', () => {
  it('cancels a pending 450ms write before cleanup and does not resurrect the old buffer', async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const autosave = createDebouncedAutosave(async (value: string) => { writes.push(value); }, () => undefined);

    autosave.schedule('old-buffer');
    await autosave.cancelAndWait();
    expect(await autosave.flush('empty-buffer')).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    await autosave.settle();

    expect(writes).toEqual(['empty-buffer']);
  });

  it('waits for an in-flight write before allowing cleanup to be written', async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    let releaseOld!: () => void;
    const oldGate = new Promise<void>((resolve) => { releaseOld = resolve; });
    const autosave = createDebouncedAutosave(async (value: string) => {
      writes.push('start:' + value);
      if (value === 'old-buffer') await oldGate;
      writes.push('complete:' + value);
    }, () => undefined);

    autosave.schedule('old-buffer');
    await vi.advanceTimersByTimeAsync(450);
    await Promise.resolve();
    const cleanup = autosave.cancelAndWait();
    releaseOld();
    await cleanup;
    expect(writes).toEqual(['start:old-buffer', 'complete:old-buffer']);

    await autosave.flush('empty-buffer');
    expect(writes).toEqual([
      'start:old-buffer', 'complete:old-buffer',
      'start:empty-buffer', 'complete:empty-buffer',
    ]);
  });

  it('exposes a persistence error and supports an explicit retry', async () => {
    vi.useFakeTimers();
    const persist = vi.fn()
      .mockRejectedValueOnce(new Error('Quota exceeded'))
      .mockResolvedValueOnce(undefined);
    const statuses: string[] = [];
    const autosave = createDebouncedAutosave(
      persist,
      (status, error) => statuses.push(status + (error instanceof Error ? ':' + error.message : '')),
    );

    autosave.schedule('buffer');
    await vi.advanceTimersByTimeAsync(450);
    await autosave.settle();
    expect(statuses).toContain('error:Quota exceeded');

    expect(await autosave.flush('buffer')).toBe(true);
    expect(persist).toHaveBeenCalledTimes(2);
    expect(statuses.at(-1)).toBe('saved');
  });
});
