import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScript } from "./load-typescript.mjs";
import { harness } from "./playback-harness.mjs";

const { SavedLyricsCache } = loadTypeScript("../app/lib/lyrics-cache.ts");
const { LyricsRequests } = loadTypeScript("../app/lib/lyrics-request.ts");
const record = { id: 1, trackName: "Song", artistName: "Artist", albumName: "Album", duration: 200,
  instrumental: false, syncedLyrics: "[00:01]First line", plainLyrics: null };
const key = "/api/lyrics/search?track=Song&artist=Artist&album=Album&duration=200";
const storage = () => { const rows = new Map(); return { getItem: (key) => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, value), rows }; };
const playing = () => Response.json({ connected: true, playing: true, positionMs: 2_000,
  item: { id: "song", type: "track", title: "Song", artist: "Artist", artists: ["Artist"], collection: "Album", durationMs: 200_000 } });

test("a reload can use saved successful lyrics during a provider cooldown without making a request", async () => {
  const disk = storage();
  let now = 1_000, calls = 0;
  const make = (cooldown = 0) => new LyricsRequests(async () => { calls++; return Response.json([record]); },
    () => now, () => cooldown, () => {}, new SavedLyricsCache(() => disk, () => now));
  await make().get(key);
  now += 60 * 60_000;
  assert.deepEqual(await make(now + 60_000).get(key), [record]);
  assert.equal(calls, 1);
  await assert.rejects(make(now + 60_000).get(key, true), (error) => error.retryAt === now + 60_000);
  assert.equal(calls, 1, "forced refresh must still obey the cooldown");
});

test("saved lyrics expire, ignore malformed storage, and bound storage to fifty records and 500k characters", () => {
  const disk = storage();
  let now = 1_000;
  const cache = new SavedLyricsCache(() => disk, () => now);
  cache.put(key, [record]);
  now += 7 * 24 * 60 * 60_000;
  assert.equal(cache.get(key), undefined);
  disk.setItem("versal-lyrics-cache-v1", "not-json");
  assert.equal(cache.get(key), undefined);
  for (let i = 0; i < 60; i++) cache.put(`${key}&variant=${i}`, [record]);
  assert.equal(JSON.parse(disk.getItem("versal-lyrics-cache-v1")).length, 50);
  assert.equal(cache.get(`${key}&variant=0`), undefined);
  cache.put(key, [{ ...record, plainLyrics: "x".repeat(600_000) }]);
  assert.ok(disk.getItem("versal-lyrics-cache-v1").length <= 500_000);
  assert.ok(cache.get(`${key}&variant=59`), "one oversized song must not evict previously saved lyrics");
  cache.put(key, []);
  assert.equal(cache.get(key), undefined, "confirmed misses are not saved for seven days");
});

test("blocked persistent storage never turns a successful lyric response into a failure", async () => {
  let calls = 0;
  const cache = new SavedLyricsCache(() => { throw new Error("Storage blocked"); });
  const requests = new LyricsRequests(async () => { calls++; return Response.json([record]); }, Date.now, () => 0, () => {}, cache);
  assert.deepEqual(await requests.get(key), [record]);
  assert.deepEqual(await requests.get(key), [record]);
  assert.equal(calls, 1);
});

test("lyric loading works without AbortSignal static helpers or Response.json", async () => {
  class OlderResponse extends Response {}
  Object.defineProperty(OlderResponse, "json", { value: undefined });
  const globals = { AbortSignal: {}, Response: OlderResponse };
  const { createBrowserLyricsFetcher } = loadTypeScript("../app/lib/lrclib-browser.ts", {}, globals);
  const { LyricsRequests: OlderRequests } = loadTypeScript("../app/lib/lyrics-request.ts", {}, globals);
  const requests = new OlderRequests(createBrowserLyricsFetcher(async () => new OlderResponse(JSON.stringify(record))));
  assert.deepEqual(await requests.get(key), [record]);
});

test("deadline cleanup removes timers/listeners and still aborts in-flight requests", () => {
  const timers = new Map();
  let next = 0;
  const { requestDeadline } = loadTypeScript("../app/lib/request-utils.ts", {}, {
    setTimeout: (fn) => { timers.set(++next, fn); return next; }, clearTimeout: (id) => timers.delete(id),
  });
  const parent = new AbortController();
  const finished = requestDeadline(10, parent.signal);
  finished.dispose();
  parent.abort();
  assert.equal(finished.signal.aborted, false);
  assert.equal(timers.size, 0);
  const timed = requestDeadline(10);
  [...timers.values()][0]();
  assert.equal(timed.signal.reason.name, "TimeoutError");
  timed.dispose();
  const cancelled = requestDeadline(10, parent.signal);
  assert.equal(cancelled.signal.aborted, true);
  cancelled.dispose();
});

test("brief network failures use 3/6/12 second recovery, then stop without a playback-triggered retry loop", async () => {
  let calls = 0;
  const app = harness(async (url) => {
    if (url === "/api/spotify/now-playing") return playing();
    calls++;
    throw new TypeError("Failed to fetch");
  });
  try {
    await app.advance(0);
    assert.equal(calls, 1);
    for (const delay of [3_000, 6_000, 12_000]) {
      assert.match(app.text(), /Finding lyrics/);
      const before = calls;
      await app.advance(delay - 1);
      assert.equal(calls, before);
      await app.advance(1);
      assert.equal(calls, before + 1);
    }
    assert.match(app.text(), /Lyrics temporarily unavailable/);
    await app.advance(60_000);
    assert.equal(calls, 4);
  } finally { app.cleanup(); }
});

test("a later recovery attempt can restore lyrics without changing the transitional page", async () => {
  let calls = 0;
  const app = harness(async (url) => {
    if (url === "/api/spotify/now-playing") return playing();
    if (++calls < 3) throw new TypeError("Failed to fetch");
    return Response.json(record);
  });
  try {
    await app.advance(8_999);
    assert.match(app.text(), /Finding lyrics/);
    await app.advance(1);
    assert.match(app.text(), /First line/);
    assert.equal(calls, 3);
  } finally { app.cleanup(); }
});

test("the real page restores saved lyrics after reload even while the provider is unavailable", async () => {
  let calls = 0;
  const original = harness(async (url) => {
    if (url === "/api/spotify/now-playing") return playing();
    calls++;
    return Response.json(record);
  });
  await original.advance(0);
  const entries = [...original.storage.entries()];
  original.cleanup();
  const reloaded = harness(async (url) => {
    if (url === "/api/spotify/now-playing") return playing();
    calls++;
    return new Response(null, { status: 503 });
  }, { storageEntries: entries.filter(([key]) => key !== "roadverse-spotify-poll-leader-v1") });
  try {
    await reloaded.advance(0);
    assert.match(reloaded.text(), /First line/);
    assert.equal(calls, 1);
  } finally { reloaded.cleanup(); }
});

test("provider retry jitter spreads requests after the required deadline, never before it", async () => {
  let calls = 0;
  const app = harness(async (url) => {
    if (url === "/api/spotify/now-playing") return playing();
    return ++calls === 1 ? new Response(null, { status: 503, headers: { "Retry-After": "10" } }) : Response.json(record);
  }, { random: 0.5 });
  try {
    await app.advance(11_499);
    assert.equal(calls, 1);
    assert.match(app.text(), /Finding lyrics/);
    await app.advance(1);
    assert.equal(calls, 2);
    assert.match(app.text(), /First line/);
  } finally { app.cleanup(); }
});
