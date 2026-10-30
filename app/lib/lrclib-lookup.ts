import { selectLyricsRecord } from "./lyrics";
import { requestDeadline, jsonResponse } from "./request-utils";

export type LyricsQuery = { track: string; artist: string; album: string; duration: number; query?: string };
type Wait = (milliseconds: number) => Promise<void>;
type Options = { signal?: AbortSignal; browser?: boolean; cache?: RequestCache };
const wait: Wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Shared matching/fallback rules; transport never changes after a provider failure. */
export async function lookupLrclib(query: LyricsQuery, fetcher: typeof fetch = fetch, pause: Wait = wait, options: Options = {}) {
  const scope = requestDeadline(15_000, options.signal);
  const signal = scope.signal;
  const request = (path: string, parameters: Record<string, string>) => {
    if (signal.aborted) throw signal.reason || new DOMException("Request cancelled", "AbortError");
    const url = new URL(`https://lrclib.net/api/${path}`);
    for (const [key, value] of Object.entries(parameters)) if (value) url.searchParams.set(key, value);
    return fetcher(url, {
      signal, cache: options.cache ?? "default",
      credentials: "omit", referrerPolicy: "no-referrer", mode: "cors",
      headers: {
        // Browsers own User-Agent. LRCLIB documents this alternative client header.
        ...(!options.browser ? { "User-Agent": "Versal/1.4 (https://github.com/baZANNN/Versal)" } : {}),
        "Lrclib-Client": "Versal/1.4 (https://github.com/baZANNN/Versal)", Accept: "application/json",
      },
    });
  };
  const result = (records: unknown[]) => jsonResponse(records.slice(0, 20), {
    headers: { "Cache-Control": records.length ? "private, max-age=300" : "no-store" },
  });
  const failure = (response: Response) => jsonResponse({ error: "Lyrics provider is temporarily unavailable." }, {
    status: response.status === 429 || response.status === 503 ? response.status : 502,
    headers: {
      ...(response.headers.has("Retry-After") ? { "Retry-After": response.headers.get("Retry-After")! } : {}),
      "X-Lyrics-Upstream-Status": String(response.status), "Cache-Control": "no-store",
    },
  });
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
      // LRCLIB asks clients to leave 200–500 ms between sequential requests.
      await pause(300);
      const structured = await request("search", { track_name: query.track, artist_name: query.artist });
      if (!structured.ok) return failure(structured);
      const matches: unknown = await structured.json();
      if (!Array.isArray(matches)) throw new Error("Invalid lyrics response");
      const record = selectLyricsRecord(matches, query.track, [query.artist], query.album, query.duration);
      return result(record ? [record] : []);
    }
    const broad = await request("search", { q: query.query || "" });
    if (!broad.ok) return failure(broad);
    const matches: unknown = await broad.json();
    if (!Array.isArray(matches)) throw new Error("Invalid lyrics response");
    return result(matches);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return jsonResponse({ error: "Lyrics provider is temporarily unavailable." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  } finally { scope.dispose(); }
}
