// Anchor server time to a monotonic timer, independent of system clock changes.
export function createClock({ fetcher = fetch, ticks = () => performance.now(), fallback = () => Date.now() } = {}) {
  let anchor = null;
  let pending = null;
  const now = () => anchor ? anchor.time + ticks() - anchor.tick : fallback();
  async function sample() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const url = new URL('./', import.meta.url);
      url.searchParams.set('clock', globalThis.crypto.randomUUID());
      const start = ticks();
      const response = await fetcher(url, { method: 'HEAD', cache: 'no-store', signal: controller.signal });
      const end = ticks();
      const time = Date.parse(response.headers.get('Date'));
      const age = Number(response.headers.get('Age') || 0);
      // Use only fresh responses, so a cached timestamp cannot set an old time.
      if (!response.ok || !Number.isFinite(time) || age !== 0 || end - start > 5000) return false;
      anchor = { time: time + (end - start) / 2, tick: end };
      return true;
    } catch { return false; }
    finally { clearTimeout(timeout); }
  }
  return {
    now,
    get synced() { return anchor !== null; },
    sync() {
      if (!pending) pending = sample().finally(() => { pending = null; });
      return pending;
    },
  };
}
