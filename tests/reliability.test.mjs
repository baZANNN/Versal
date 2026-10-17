import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScript } from "./load-typescript.mjs";

const { PlaybackClock } = loadTypeScript("../app/lib/playback-clock.ts");
const { parseLyrics, selectLyricsRecord } = loadTypeScript("../app/lib/lyrics.ts");
const { LyricsRequests, retryDeadline, lyricsRetryDeadline } = loadTypeScript("../app/lib/lyrics-request.ts");
const { lookupLrclib, LrclibService } = loadTypeScript("../app/lib/lrclib.ts");
const record = (overrides = {}) => ({ id: 1, trackName: "Song", artistName: "Artist", albumName: "Album", duration: 200, instrumental: false, syncedLyrics: "[00:05]First line", plainLyrics: "First line", ...overrides });

test("clock follows elapsed time despite delayed timer callbacks", () => {
  const clock = new PlaybackClock();
  clock.sync(20, 200, true, 1_000, true);
  assert.equal(clock.read(4_500), 23.5);
  assert.equal(clock.read(6_000), 25);
});

test("pause, resume, backward seek, and ahead correction use Spotify's position", () => {
  const clock = new PlaybackClock();
  clock.sync(20, 200, true, 0, true);
  assert.equal(clock.sync(21, 200, false, 3_000), 21);
  assert.equal(clock.read(30_000), 21);
  clock.sync(21, 200, true, 30_000);
  assert.equal(clock.read(31_000), 22);
  assert.equal(clock.sync(21.3, 200, true, 31_000), 21.3);
  assert.equal(clock.sync(4, 200, true, 32_000), 4);
  assert.equal(clock.pause(33_000), 5);
  assert.equal(clock.read(40_000), 5);
});

test("clock stops extrapolating indefinitely after playback data disappears", () => {
  const clock = new PlaybackClock();
  clock.sync(20, 200, true, 0);
  assert.equal(clock.read(60_000), 30);
  clock.sync(199, 200, true, 60_000, true);
  assert.equal(clock.read(65_000), 200);
});

test("LRC parser expands repeated timestamps, sorts, honors offsets, and groups simultaneous lines", () => {
  const parsed = parseLyrics("[offset:500]\r\n[00:20.50][00:40.50]Repeat\r\n[00:05.00]First\r\n[00:05.00]Harmony\r\n[00:10.00]\r\n[00:99.00]Invalid", null);
  assert.equal(parsed.synced, true);
  assert.deepEqual(parsed.lines, [
    { time: 4.5, text: "First\nHarmony" }, { time: 9.5, text: "♪" },
    { time: 20, text: "Repeat" }, { time: 40, text: "Repeat" },
  ]);
  assert.equal(parsed.lines.findLastIndex((line) => line.time <= 0), -1);
});

test("plain lyrics never receive invented activation times", () => {
  const parsed = parseLyrics("[ar:Artist]", "One\n\nTwo");
  assert.equal(parsed.synced, false);
  assert.ok(parsed.lines.every((line) => line.time === Infinity));
});

test("matching retains non-Latin titles and rejects blank artists and substring collisions", () => {
  const japanese = record({ trackName: "夜に駆ける", artistName: "ヨアソビ" });
  assert.equal(selectLyricsRecord([japanese], "夜に駆ける", ["ヨアソビ"], "Album", 200), japanese);
  assert.equal(selectLyricsRecord([record({ artistName: "" })], "Song", ["Artist"], "Album", 200), undefined);
  assert.equal(selectLyricsRecord([record({ trackName: "Homecoming" })], "Home", ["Artist"], "Album", 200), undefined);
  const correct = record({ syncedLyrics: null });
  assert.equal(selectLyricsRecord([record({ trackName: "Another song" }), correct], "Song", ["Artist"], "Album", 200), correct);
});

test("duration helps reject a mismatched live version when a matching studio record exists", () => {
  const studio = record({ syncedLyrics: null });
  const live = record({ id: 2, trackName: "Song - Live", duration: 280 });
  assert.equal(selectLyricsRecord([live, studio], "Song", ["Artist"], "Album", 200), studio);
});

test("concurrent and force-refresh lyric lookups share an in-flight request", async () => {
  let finish;
  let calls = 0;
  const requests = new LyricsRequests(() => { calls++; return new Promise((resolve) => { finish = resolve; }); });
  const first = requests.get("/lyrics");
  const second = requests.get("/lyrics", true);
  assert.equal(calls, 1);
  finish(Response.json([record()]));
  assert.deepEqual(await first, await second);
  await requests.get("/lyrics");
  assert.equal(calls, 1);
});

test("lyric requests do not invoke browser fetch with the cache instance as its receiver", async () => {
  const browserFetch = function () {
    if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
    return Promise.resolve(Response.json([record()]));
  };
  const requests = new LyricsRequests(browserFetch);
  assert.deepEqual(await requests.get("/lyrics"), [record()]);
  assert.deepEqual(await requests.get("/lyrics", true), [record()]);
});

test("lyrics cooldown survives a new loader and force refresh cannot bypass it", async () => {
  let now = 1_000, stored = 0, calls = 0;
  const fetcher = async () => { calls++; return new Response(null, { status: 429, headers: { "Retry-After": "120" } }); };
  const make = () => new LyricsRequests(fetcher, () => now, () => stored, (deadline) => { stored = deadline; });
  await assert.rejects(make().get("/one"), (error) => error.status === 429 && error.retryAt === 121_000);
  now = 61_000;
  await assert.rejects(make().get("/two", true), (error) => error.retryAt === 121_000);
  assert.equal(calls, 1);
  now = 121_001;
  await assert.rejects(make().get("/two", true));
  assert.equal(calls, 2);
});

test("Retry-After supports seconds, HTTP dates, and a bounded fallback", () => {
  assert.equal(retryDeadline("60", 1_000), 61_000);
  assert.equal(retryDeadline("Thu, 01 Jan 1970 00:02:00 GMT", 1_000), 120_000);
  assert.equal(retryDeadline("invalid", 1_000), 31_000);
});

const query = { track: "Song", artist: "Artist", album: "Album", duration: 200 };
test("browser follows short repeated server deadlines without adding backoff", async () => {
  let now = 1_000, calls = 0;
  const loader = new LyricsRequests(async () => { calls++; return new Response(null, { status: 429, headers: { "Retry-After": calls === 3 ? "1800" : "2" } }); }, () => now);
  await assert.rejects(loader.get("/song"), (error) => error.retryAt === 3_000);
  now = 2_999;
  await assert.rejects(loader.get("/new-song", true));
  assert.equal(calls, 1);
  now = 3_000;
  await assert.rejects(loader.get("/song", true), (error) => error.retryAt === 5_000);
  now = 5_000;
  await assert.rejects(loader.get("/song", true), (error) => error.retryAt === 1_805_000);
});

test("an empty exact record gets one usable fallback search", async () => {
  let calls = 0;
  const response = await lookupLrclib(query, async () => {
    calls++;
    if (calls === 1) return Response.json(record({ syncedLyrics: null, plainLyrics: "  " }));
    return Response.json([record()]);
  });
  assert.equal(calls, 2);
  assert.deepEqual(await response.json(), [record()]);
});

test("Worker coalesces identical lookups and serves cached lyrics during a cooldown", async () => {
  let now = 1_000, calls = 0, finish;
  const service = new LrclibService(() => {
    calls++;
    if (calls === 1) return new Promise((resolve) => { finish = resolve; });
    return Promise.resolve(new Response(null, { status: 429, headers: { "Retry-After": "120" } }));
  }, () => now);
  const first = service.get(query), duplicate = service.get(query);
  assert.equal(calls, 1);
  finish(Response.json(record()));
  assert.deepEqual(await (await first).json(), await (await duplicate).json());
  const throttled = await service.get({ ...query, track: "Another" });
  assert.equal(throttled.status, 429);
  assert.equal(throttled.headers.get("Retry-After"), "120");
  now += 30_000;
  const blocked = await service.get({ ...query, track: "Third" });
  assert.equal(blocked.headers.get("Retry-After"), "90");
  assert.equal(calls, 2);
  assert.deepEqual(await (await service.get(query)).json(), [record()]);
  assert.equal(calls, 2);
});

test("LRCLIB fallback performs each search once and does not cache a miss", async () => {
  const urls = [];
  const response = await lookupLrclib(query, async (url) => {
    urls.push(url.href);
    return url.pathname.endsWith("/get") ? new Response(null, { status: 404 }) : Response.json([]);
  });
  assert.equal(urls.length, 2);
  assert.equal(new Set(urls).size, 2);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), []);
});

for (const stage of [1, 2]) test(`LRCLIB stops immediately on a 429 at fallback stage ${stage}`, async () => {
  let calls = 0;
  const response = await lookupLrclib(query, async () => {
    calls++;
    if (calls === stage) return new Response(null, { status: 429, headers: { "Retry-After": "300" } });
    return calls === 1 ? new Response(null, { status: 404 }) : Response.json([]);
  });
  assert.equal(calls, stage);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "300");
});

test("lyrics Retry-After distinguishes missing/invalid values from seconds and HTTP dates", () => {
  for (const header of [null, "", "invalid", "-1", "NaN", "Infinity"]) assert.equal(lyricsRetryDeadline(header, 1_000), null);
  assert.equal(lyricsRetryDeadline("2", 1_000), 3_000);
  assert.equal(lyricsRetryDeadline("0", 1_000), 2_000);
  assert.equal(lyricsRetryDeadline("Thu, 01 Jan 1970 00:02:00 GMT", 1_000), 120_000);
});

test("server and browser honor one deadline, with no multiplication of repeated 429s", async () => {
  let now = 1_000, calls = 0;
  const events = [];
  const service = new LrclibService(async () => {
    calls++;
    return calls <= 2 ? new Response(null, { status: 429, headers: { "Retry-After": "2" } }) : Response.json(record());
  }, () => now, (event) => events.push(event));
  const loader = new LyricsRequests(() => service.get(query), () => now);
  await assert.rejects(loader.get("/song"), (error) => error.retryAt === 3_000);
  now = 2_000;
  const blocked = await service.get(query);
  assert.equal(blocked.headers.get("Retry-After"), "1");
  assert.equal(calls, 1);
  now = 3_000;
  await assert.rejects(loader.get("/song"), (error) => error.retryAt === 5_000);
  now = 5_000;
  assert.deepEqual(await loader.get("/song"), [record()]);
  assert.equal(calls, 3);
  assert.deepEqual(events.map((event) => event.source), ["provider", "local-gate", "provider"]);
  assert.equal(events[0].providerRetryAfter, "2");
  assert.equal(events[1].upstreamRequested, false);
});

test("only missing or invalid provider deadlines escalate, capped at five minutes", async () => {
  let now = 1_000, header = null;
  const events = [];
  const service = new LrclibService(async () => new Response(null, { status: 429,
    headers: header === null ? {} : { "Retry-After": header },
  }), () => now, (event) => events.push(event));
  for (const seconds of [30, 60, 120, 240, 300, 300]) {
    const response = await service.get(query);
    assert.equal(response.headers.get("Retry-After"), String(seconds));
    assert.equal(response.headers.get("X-Lyrics-Retry-Source"), "fallback");
    now += seconds * 1_000;
  }
  assert.equal(events[0].providerRetryAfter, null);
  header = "2";
  assert.equal((await service.get(query)).headers.get("Retry-After"), "2");
  now += 2_000;
  header = "1800";
  assert.equal((await service.get(query)).headers.get("Retry-After"), "1800");
  now += 1_800_000;
  header = "invalid";
  assert.equal((await service.get(query)).headers.get("Retry-After"), "30");
  assert.equal(events.at(-1).providerRetryAfter, "invalid");
});

test("confirmed misses are cached for five minutes and stop after one fallback", async () => {
  let now = 1_000, calls = 0;
  const service = new LrclibService(async (url) => {
    calls++;
    return url.pathname.endsWith("/get") ? new Response(null, { status: 404 }) : Response.json([record({ artistName: "Unrelated" })]);
  }, () => now);
  assert.deepEqual(await (await service.get(query)).json(), []);
  assert.equal(calls, 2);
  now += 299_999;
  assert.deepEqual(await (await service.get(query)).json(), []);
  assert.equal(calls, 2);
  now++;
  await service.get(query);
  assert.equal(calls, 4);
});

test("an exact lyric match uses one provider request across repeat plays", async () => {
  let calls = 0;
  const service = new LrclibService(async () => { calls++; return Response.json(record()); });
  assert.deepEqual(await (await service.get(query)).json(), [record()]);
  assert.deepEqual(await (await service.get(query)).json(), [record()]);
  assert.equal(calls, 1);
});

test("provider HTTP-date waits are honored and successful recovery resets fallback backoff", async () => {
  let now = 1_000, response = new Response(null, { status: 429, headers: { "Retry-After": "Thu, 01 Jan 1970 00:02:00 GMT" } });
  const events = [];
  const service = new LrclibService(async () => response.clone(), () => now, (event) => events.push(event));
  assert.equal((await service.get(query)).headers.get("Retry-After"), "119");
  now = 120_000;
  response = new Response(null, { status: 429 });
  assert.equal((await service.get(query)).headers.get("Retry-After"), "30");
  now += 30_000;
  response = Response.json(record());
  assert.equal((await service.get(query)).status, 200);
  response = new Response(null, { status: 429 });
  assert.equal((await service.get({ ...query, track: "New" })).headers.get("Retry-After"), "30");
  assert.equal(events[0].providerRetryAt, 120_000);
});

test("a transient token refresh error is not treated as a revoked login", async () => {
  const session = { accessToken: "test-access", refreshToken: "test-refresh", expiresAt: 0 };
  let response = Response.json({ error: "temporarily_unavailable" }, { status: 503 });
  const spotify = loadTypeScript("../app/lib/spotify.ts", { "./session": { unseal: async () => session } }, {
    fetch: async () => response,
    process: { env: { SPOTIFY_CLIENT_ID: "test", SPOTIFY_CLIENT_SECRET: "test", SPOTIFY_REDIRECT_URI: "https://example.com/callback" } },
  });
  const request = { cookies: { get: () => ({ value: "test-session" }) } };
  await assert.rejects(spotify.validSpotifySession(request), (error) => error.status === 502);
  response = Response.json({ error: "invalid_grant" }, { status: 400 });
  await assert.rejects(spotify.validSpotifySession(request), (error) => error.status === 401);
  response = new Response(null, { status: 429, headers: { "Retry-After": "60" } });
  await assert.rejects(spotify.validSpotifySession(request), (error) => error.status === 429 && error.retryAfter === "60");
});
