import { selectLyricsRecord } from "./lyrics";
import { lyricsRetryDeadline } from "./lyrics-request";

type Query = { track: string; artist: string; album: string; duration: number; query?: string };

// Each fallback is tried at most once. A throttle or outage ends the sequence immediately.
export async function lookupLrclib(query: Query, fetcher: typeof fetch = fetch) {
  const signal = AbortSignal.timeout(15_000);
  const request = (path: string, parameters: Record<string, string>) => {
    const url = new URL(`https://lrclib.net/api/${path}`);
    for (const [key, value] of Object.entries(parameters)) if (value) url.searchParams.set(key, value);
    return fetcher(url, { signal, headers: { "User-Agent": "Versal", "Lrclib-Client": "Versal/1.3", Accept: "application/json" } });
  };
  const result = (records: unknown[]) => Response.json(records.slice(0, 20), {
    headers: { "Cache-Control": records.length ? "private, max-age=300" : "no-store" },
  });
  const failure = (response: Response) => response.status === 429
    ? Response.json({ error: "Lyrics provider is cooling down." }, { status: 429, headers: { ...(response.headers.has("Retry-After") ? { "Retry-After": response.headers.get("Retry-After")! } : {}), "Cache-Control": "no-store" } })
    : Response.json({ error: "Lyrics provider is temporarily unavailable." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  try {
    if (query.track && query.artist) {
      const exact = await request("get", {
        track_name: query.track, artist_name: query.artist, album_name: query.album,
        duration: Number.isFinite(query.duration) && query.duration > 0 ? String(query.duration) : "",
      });
      if (exact.ok) {
        const record = selectLyricsRecord([await exact.json()], query.track, [query.artist], query.album, query.duration);
        if (record) return result([record]);
      } else if (exact.status !== 404) return failure(exact);
      const structured = await request("search", { track_name: query.track, artist_name: query.artist });
      if (!structured.ok) return failure(structured);
      const matches: unknown = await structured.json();
      if (!Array.isArray(matches)) throw new Error("Invalid lyrics response");
      const record = selectLyricsRecord(matches, query.track, [query.artist], query.album, query.duration);
      return result(record ? [record] : []);
    }
    const broad = await request("search", { q: query.track && query.artist ? `${query.track} ${query.artist}` : query.query || "" });
    if (!broad.ok) return failure(broad);
    const matches: unknown = await broad.json();
    if (!Array.isArray(matches)) throw new Error("Invalid lyrics response");
    return result(matches);
  } catch {
    return Response.json({ error: "Lyrics provider is temporarily unavailable." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}

type LookupResult = { body: string; status: number; headers: Record<string, string> };

// Best-effort per-Worker cache: no credentials, cookies, or listener identity stored.
// It reduces duplicate requests across tabs/listeners but is not a global quota gate.
export class LrclibService {
  private cache = new Map<string, { result: LookupResult; expiresAt: number }>();
  private pending = new Map<string, Promise<LookupResult>>();
  private cooldown = 0;
  private missingDeadlineCount = 0;
  constructor(
    private fetcher: typeof fetch = fetch,
    private now = Date.now,
    private log: (event: Record<string, unknown>) => void = (event) => console.warn(JSON.stringify(event)),
  ) {}

  private cooldownResponse() {
    const seconds = Math.max(1, Math.ceil((this.cooldown - this.now()) / 1_000));
    this.log({ event: "lyrics_cooldown", source: "local-gate", upstreamRequested: false, waitSeconds: seconds, retryAt: this.cooldown });
    return Response.json({ error: "Lyrics lookup is waiting before retrying." }, {
      status: 429, headers: { "Retry-After": String(seconds), "X-Lyrics-Retry-Source": "local-gate", "Cache-Control": "no-store" },
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
        if (response.status === 429) {
          const now = this.now();
          const header = response.headers.get("Retry-After");
          const providerDeadline = lyricsRetryDeadline(header, now);
          const source = providerDeadline === null ? "fallback" : "provider";
          // Escalate only when LRCLIB supplies no usable deadline. A valid
          // provider wait is authoritative, even after earlier throttles.
          const deadline = providerDeadline ?? now + Math.min(300_000, 30_000 * 2 ** Math.min(this.missingDeadlineCount++, 4));
          if (providerDeadline !== null) this.missingDeadlineCount = 0;
          this.cooldown = Math.max(this.cooldown, deadline);
          const seconds = Math.ceil((this.cooldown - now) / 1_000);
          result.headers["retry-after"] = String(seconds);
          result.headers["x-lyrics-retry-source"] = source;
          this.log({ event: "lyrics_cooldown", source, upstreamRequested: true, upstreamStatus: 429,
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
