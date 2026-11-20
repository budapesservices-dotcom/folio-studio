export type AutosaveStatus = 'saving' | 'saved' | 'error';

export interface DebouncedAutosave<T> {
  schedule(value: T): void;
  cancel(): void;
  cancelAndWait(): Promise<void>;
  flush(value: T): Promise<boolean>;
  settle(): Promise<void>;
}

/**
 * Serializes every buffer write behind one promise chain. A generation token
 * invalidates queued debounce callbacks; cancelAndWait waits for an in-flight
 * IndexedDB write before the caller is allowed to write a cleanup snapshot.
 */
export function createDebouncedAutosave<T>(
  persist: (value: T) => Promise<void>,
  onStatus: (status: AutosaveStatus, error?: unknown) => void,
  delay = 450,
): DebouncedAutosave<T> {
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> = Promise.resolve();

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const cancel = () => {
    generation += 1;
    clearTimer();
  };

  const enqueue = (value: T, token: number): Promise<boolean> => {
    const result = inFlight.then(async () => {
      if (token !== generation) return false;
      try {
        await persist(value);
        if (token === generation) onStatus('saved');
        return token === generation;
      } catch (error) {
        if (token === generation) onStatus('error', error);
        return false;
      }
    });
    inFlight = result.then(() => undefined, () => undefined);
    return result;
  };

  return {
    schedule(value) {
      cancel();
      const token = generation;
      onStatus('saving');
      timer = setTimeout(() => {
        timer = null;
        void enqueue(value, token);
      }, delay);
    },

    cancel,

    async cancelAndWait() {
      cancel();
      await inFlight;
    },

    async settle() {
      await inFlight;
    },

    flush(value) {
      cancel();
      const token = generation;
      onStatus('saving');
      return enqueue(value, token);
    },
  };
}
