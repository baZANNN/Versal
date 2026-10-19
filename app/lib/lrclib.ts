import { lookupLrclib, type LyricsQuery as Query } from "./lrclib-lookup";
import { lyricsRetryDeadline } from "./lyrics-request";

export { lookupLrclib } from "./lrclib-lookup";

type LookupResult = { body: string; status: number; headers: Record<string, string> };

// Best-effort per-Worker cache: no credentials, cookies, or listener identity stored.
// It reduces duplicate requests across tabs/listeners but is not a global quota gate.
export class LrclibService {
  private cache = new Map<string, { result: LookupResult; expiresAt: number }>();
  private pending = new Map<string, Promise<LookupResult>>();
  private cooldown = 0;
  private missingDeadlineCount = 0;
  private cooldownStatus = 429;
  constructor(
    private fetcher: typeof fetch = fetch,
    private now = Date.now,
    private log: (event: Record<string, unknown>) => void = (event) => console.warn(JSON.stringify(event)),
  ) {}

  private cooldownResponse() {
    const seconds = Math.max(1, Math.ceil((this.cooldown - this.now()) / 1_000));
    this.log({ event: "lyrics_cooldown", source: "local-gate", upstreamRequested: false, waitSeconds: seconds, retryAt: this.cooldown });
    return Response.json({ error: "Lyrics lookup is waiting before retrying." }, {
      status: this.cooldownStatus, headers: { "Retry-After": String(seconds), "X-Lyrics-Retry-Source": "local-gate", "Cache-Control": "no-store" },
    });
  }

  async get(query: Query): Promise<Response> {
    const key = JSON.stringify([query.track, query.artist, query.album, query.duration, query.query || ""]);
    for (const [entryKey, entry] of this.cache) if (entry.expiresAt <= this.now()) this.cache.delete(entryKey);
    const cached = this.cache.get(key);
    if (cached) return new Response(cached.result.body, { status: cached.result.status, headers: cached.result.headers });
    if (this.cooldown > this.now()) return this.cooldownResponse();
    let pending = this.pending.get(key);
    if (!pending) {
      // Pass the fetch function as a standalone callback; never invoke it with this instance.
      pending = lookupLrclib(query, this.fetcher).then(async (response) => {
        const result = { body: await response.text(), status: response.status, headers: Object.fromEntries(response.headers.entries()) };
        const providerDeadline = lyricsRetryDeadline(response.headers.get("Retry-After"), this.now());
        if (response.status === 429 || (response.status === 503 && providerDeadline !== null)) {
          const now = this.now();
          const header = response.headers.get("Retry-After");
          const source = providerDeadline === null ? "fallback" : "provider";
          // Escalate only when LRCLIB supplies no usable deadline. A valid
          // provider wait is authoritative, even after earlier throttles.
          const deadline = providerDeadline ?? now + Math.min(300_000, 30_000 * 2 ** Math.min(this.missingDeadlineCount++, 4));
          if (providerDeadline !== null) this.missingDeadlineCount = 0;
          this.cooldownStatus = response.status;
          this.cooldown = Math.max(this.cooldown, deadline);
          const seconds = Math.ceil((this.cooldown - now) / 1_000);
          result.headers["retry-after"] = String(seconds);
          result.headers["x-lyrics-retry-source"] = source;
          this.log({ event: "lyrics_cooldown", source, upstreamRequested: true, upstreamStatus: response.status,
            providerRetryAfter: header?.slice(0, 128) ?? null, providerRetryAt: providerDeadline,
            waitSeconds: seconds, retryAt: this.cooldown });
        } else if (response.ok) {
          this.missingDeadlineCount = 0;
          const empty = result.body === "[]";
          if (result.body.length <= 100_000) this.cache.set(key, { result, expiresAt: this.now() + (empty ? 5 * 60_000 : 30 * 60_000) });
          // Bound retained text to ~1 MiB (UTF-16), with at most 50 songs.
          let characters = [...this.cache.values()].reduce((sum, entry) => sum + entry.result.body.length, 0);
          for (const [entryKey, entry] of this.cache) {
            if (this.cache.size <= 50 && characters <= 500_000) break;
            characters -= entry.result.body.length;
            this.cache.delete(entryKey);
          }
        }
        return result;
      }).finally(() => { this.pending.delete(key); });
      this.pending.set(key, pending);
    }
    const result = await pending;
    return new Response(result.body, { status: result.status, headers: result.headers });
  }
}
