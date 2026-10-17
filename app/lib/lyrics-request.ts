export function retryDeadline(header: string | null, now: number, fallbackSeconds = 30) {
  const seconds = header?.trim() ? Number(header) : NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return now + Math.max(1, Math.ceil(seconds)) * 1_000;
  const date = header ? Date.parse(header) : NaN;
  return Number.isFinite(date) ? Math.max(now + 1_000, date) : now + fallbackSeconds * 1_000;
}

// Separate from Spotify's existing parser: absent/invalid lyrics headers must
// remain distinguishable from a provider-requested deadline.
export function lyricsRetryDeadline(header: string | null, now: number): number | null {
  const value = header?.trim();
  if (!value) return null;
  if (/^\d+(\.\d+)?$/.test(value)) {
    const deadline = now + Math.max(1, Math.ceil(Number(value))) * 1_000;
    return Number.isFinite(deadline) ? deadline : null;
  }
  if (!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i.test(value)) return null;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(now + 1_000, date) : null;
}

export class LyricsRequestError extends Error {
  constructor(public status: number, public retryAt = 0) {
    super("Lyrics lookup unavailable");
  }
}

type Entry = { promise: Promise<unknown[]>; pending: boolean; expiresAt: number };

export class LyricsRequests {
  private cache = new Map<string, Entry>();
  private cooldown = 0;
  constructor(
    private fetcher: typeof fetch = fetch,
    private now = Date.now,
    private readCooldown = () => 0,
    private writeCooldown = (_deadline: number) => {},
  ) {}

  async get(url: string, force = false): Promise<unknown[]> {
    const cached = this.cache.get(url);
    if (cached && (cached.pending || (!force && cached.expiresAt > this.now()))) return cached.promise;
    const deadline = Math.max(this.cooldown, this.readCooldown());
    if (deadline > this.now()) throw new LyricsRequestError(429, deadline);

    const entry: Entry = { promise: Promise.resolve([]), pending: true, expiresAt: 0 };
    // Native browser fetch rejects an arbitrary object as its receiver.
    // Call the injected function directly, not as a LyricsRequests method.
    const fetcher = this.fetcher;
    entry.promise = fetcher(url, { cache: force ? "reload" : "default", signal: AbortSignal.timeout(20_000) })
      .then(async (response) => {
        if (response.status === 429) {
          // The server already owns backoff. Never multiply its remaining wait.
          const now = this.now();
          this.cooldown = Math.max(this.cooldown, lyricsRetryDeadline(response.headers.get("Retry-After"), now) ?? now + 30_000);
          this.writeCooldown(this.cooldown);
          throw new LyricsRequestError(429, this.cooldown);
        }
        if (!response.ok) throw new LyricsRequestError(response.status);
        const records: unknown = await response.json();
        if (!Array.isArray(records)) throw new LyricsRequestError(502);
        entry.expiresAt = this.now() + (records.length ? 30 * 60_000 : 5 * 60_000);
        return records;
      })
      .catch((error) => {
        if (this.cache.get(url) === entry) this.cache.delete(url);
        throw error;
      })
      .finally(() => { entry.pending = false; });
    this.cache.delete(url);
    this.cache.set(url, entry);
    // Bound memory during long drives. Pending requests still finish for their callers.
    while (this.cache.size > 50) this.cache.delete(this.cache.keys().next().value!);
    return entry.promise;
  }
}
