import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScript } from "./load-typescript.mjs";

const { createBrowserLyricsFetcher } = loadTypeScript("../app/lib/lrclib-browser.ts");
const { LyricsRequests } = loadTypeScript("../app/lib/lyrics-request.ts");
const record = { id: 1, trackName: "Song", artistName: "Artist", albumName: "Album", duration: 200.125,
  instrumental: false, syncedLyrics: "[00:05]First line", plainLyrics: "First line" };
const song = "/api/lyrics/search?track=Song&artist=Artist&album=Album&duration=200.125";

test("direct exact lookup uses the public provider and never forwards credentials or arbitrary headers", async () => {
  const calls = [];
  const adapter = createBrowserLyricsFetcher(async (url, options) => {
    calls.push({ url, options });
    return Response.json(record);
  });
  const response = await adapter(song, { credentials: "include", headers: { Authorization: "do-not-forward", Cookie: "do-not-forward" }, cache: "reload" });
  assert.deepEqual(await response.json(), [record]);
  assert.equal(calls.length, 1);
  const { url, options } = calls[0];
  assert.equal(url.origin, "https://lrclib.net");
  assert.equal(url.pathname, "/api/get");
  assert.equal(url.searchParams.get("duration"), "200.125");
  assert.equal(url.searchParams.get("album_name"), "Album");
  assert.equal(options.credentials, "omit");
  assert.equal(options.mode, "cors");
  assert.equal(options.referrerPolicy, "no-referrer");
  assert.equal(options.cache, "reload");
  assert.deepEqual(options.headers, { "Lrclib-Client": "Versal/1.4", Accept: "application/json" });
});

test("the browser's native fetch is called without an arbitrary receiver", async () => {
  const fetcher = function () {
    assert.ok(this === undefined || this === globalThis);
    return Promise.resolve(Response.json(record));
  };
  assert.deepEqual(await (await createBrowserLyricsFetcher(fetcher)(song)).json(), [record]);
});

test("a direct miss waits 300 ms, then makes exactly one structured search", async () => {
  const events = [];
  const adapter = createBrowserLyricsFetcher(async (url) => {
    events.push(url.pathname);
    return url.pathname.endsWith("/get") ? new Response(null, { status: 404 }) : Response.json([record]);
  }, async (milliseconds) => { events.push(milliseconds); });
  assert.deepEqual(await (await adapter(song)).json(), [record]);
  assert.deepEqual(events, ["/api/get", 300, "/api/search"]);
});

for (const status of [429, 503]) test(`a direct ${status} persists Retry-After and cannot switch to the proxy or bypass it on refresh/reload`, async () => {
  let now = 1_000, saved = 0, calls = 0;
  const adapter = createBrowserLyricsFetcher(async (url) => {
    assert.equal(url.origin, "https://lrclib.net");
    calls++;
    return new Response("Not JSON", { status, headers: { "Retry-After": "60" } });
  });
  const make = () => new LyricsRequests(adapter, () => now, () => saved, (deadline) => { saved = deadline; });
  await assert.rejects(make().get(song), (error) => error.status === status && error.retryAt === 61_000);
  now = 60_999;
  await assert.rejects(make().get(song, true), (error) => error.retryAt === 61_000);
  assert.equal(calls, 1);
});

test("CORS/network failures do not silently retry through a second transport", async () => {
  let calls = 0;
  const adapter = createBrowserLyricsFetcher(async (url) => {
    assert.equal(url.origin, "https://lrclib.net");
    calls++;
    throw new TypeError("Failed to fetch");
  });
  assert.equal((await adapter(song)).status, 502);
  assert.equal(calls, 1);
});

test("abort during the fallback gap prevents a second provider request", async () => {
  let calls = 0;
  const controller = new AbortController();
  const adapter = createBrowserLyricsFetcher(async () => {
    calls++;
    return new Response(null, { status: 404 });
  }, async () => { controller.abort(); });
  await assert.rejects(adapter(song, { signal: controller.signal }), (error) => error.name === "AbortError");
  assert.equal(calls, 1);
});

test("direct lookups retain coalescing, successful-result caching, and confirmed-miss caching", async () => {
  let now = 1_000, calls = 0, missing = false;
  const adapter = createBrowserLyricsFetcher(async (url) => {
    calls++;
    return missing ? (url.pathname.endsWith("/get") ? new Response(null, { status: 404 }) : Response.json([])) : Response.json(record);
  }, async () => {});
  const loader = new LyricsRequests(adapter, () => now);
  const [first, duplicate] = await Promise.all([loader.get(song), loader.get(song, true)]);
  assert.deepEqual(first, duplicate);
  assert.equal(calls, 1);
  now += 29 * 60_000;
  assert.deepEqual(await loader.get(song), [record]);
  assert.equal(calls, 1);
  missing = true;
  now += 60_001;
  assert.deepEqual(await loader.get(song), []);
  assert.equal(calls, 3);
  await loader.get(song);
  assert.equal(calls, 3);
});

test("invalid cache keys do not become arbitrary provider or proxy requests", async () => {
  const adapter = createBrowserLyricsFetcher(async () => { throw new Error("Must not fetch"); });
  for (const url of ["/api/spotify/now-playing", "/api/lyrics/search?track=Song", "/api/lyrics/search?track=Song&artist=" + "a".repeat(501)]) {
    assert.equal((await adapter(url)).status, 400);
  }
});

test("direct 429s without a usable deadline retain bounded escalating fallback waits", async () => {
  let now = 1_000;
  const adapter = createBrowserLyricsFetcher(async () => new Response(null, { status: 429 }));
  const loader = new LyricsRequests(adapter, () => now);
  for (const seconds of [30, 60, 120, 240, 300, 300]) {
    await assert.rejects(loader.get(song), (error) => error.retryAt === now + seconds * 1_000);
    now += seconds * 1_000;
  }
});

test("a late short throttle response cannot shorten a newer shared cooldown", async () => {
  let saved = 0, finish;
  const loader = new LyricsRequests(() => new Promise((resolve) => { finish = resolve; }), () => 1_000, () => saved, (deadline) => { saved = deadline; });
  const pending = loader.get(song);
  saved = 121_000; // A second tab receives a longer provider wait first.
  finish(new Response(null, { status: 429, headers: { "Retry-After": "1" } }));
  await assert.rejects(pending, (error) => error.retryAt === 121_000);
  assert.equal(saved, 121_000);
});
