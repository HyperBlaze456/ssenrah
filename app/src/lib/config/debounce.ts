export function createDebouncedSaver(delayMs: number = 500) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  return function scheduleSave(key: string, saveFn: () => Promise<void>) {
    const existing = timers.get(key);
    if (existing) clearTimeout(existing);

    timers.set(key, setTimeout(async () => {
      timers.delete(key);
      await saveFn();
    }, delayMs));
  };
}
