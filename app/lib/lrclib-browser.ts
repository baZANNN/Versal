import { lookupLrclib } from "./lrclib-lookup";
import { jsonResponse } from "./request-utils";

/**
 * Adapt the loader's stable song/cache URL to LRCLIB's public CORS API.
 * The URL is a cache key, not a proxy request. Never forward its origin,
 * cookies, authorization headers, or other caller-supplied request options.
 */
export function createBrowserLyricsFetcher(fetcher: typeof fetch = fetch, pause?: (milliseconds: number) => Promise<void>): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "https://versal.invalid");
    const params = url.searchParams;
    const track = params.get("track")?.trim() || "";
    const artist = params.get("artist")?.trim() || "";
    const album = params.get("album")?.trim() || "";
    if (url.pathname !== "/api/lyrics/search" || !track || !artist || [track, artist, album].some((value) => value.length > 500)) {
      return jsonResponse({ error: "Invalid song details." }, { status: 400 });
    }
    return lookupLrclib({ track, artist, album, duration: Number(params.get("duration") || 0) }, fetcher, pause, {
      browser: true, signal: init?.signal ?? undefined, cache: init?.cache,
    });
  };
}
