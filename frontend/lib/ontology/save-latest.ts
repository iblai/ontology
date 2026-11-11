/** Saves the newest value, one request at a time; a failure a newer value overtakes is not told. */
export function saveLatest<T, R extends { ok: boolean }>(
  send: (value: T) => Promise<R>,
  settled: (value: T, result: R) => void,
): (value: T) => Promise<void> {
  // At most one value waits: a newer one takes its place.
  const waiting: T[] = [];
  let busy = false;
  return async (value) => {
    waiting[0] = value;
    if (busy) return;
    busy = true;
    try {
      while (waiting.length > 0) {
        const sending = waiting.pop() as T;
        const result = await send(sending);
        if (result.ok || waiting.length === 0) settled(sending, result);
      }
    } finally {
      busy = false;
    }
  };
}
