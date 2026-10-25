import assert from "node:assert/strict";
import test from "node:test";
import { harness } from "./playback-harness.mjs";

const playback = (title = "Song", playing = true, positionMs = 2_000) => ({ connected: true, playing, positionMs,
  item: { id: title, type: "track", title, artist: "Artist", artists: ["Artist"], collection: "Album", durationMs: 200_000 } });
const lyrics = (title = "Song") => ({ id: 1, trackName: title, artistName: "Artist", albumName: "Album", duration: 200,
  instrumental: false, syncedLyrics: `[00:01]${title} first line\n[00:04]${title} second line`, plainLyrics: null });
const empty = () => Response.json({ connected: true, playing: false, item: null });
const active = (app) => app.text(app.find((node) => node.props?.className === "active-lyric-layer"));

test("one empty Spotify sample keeps the current lyric and rechecks within a second", async () => {
  let polls = 0, lyricCalls = 0;
  const app = harness(async (url) => {
    if (url === "/api/spotify/now-playing") return ++polls === 2 ? empty() : Response.json(playback());
    lyricCalls++;
    return Response.json(lyrics());
  });
  try {
    await app.advance(0);
    await app.advance(1_000);
    assert.match(active(app), /Song first line/);
    assert.doesNotMatch(app.text(), /Start a song/);
    await app.advance(1_000);
    assert.equal(polls, 3);
    assert.equal(lyricCalls, 1, "recovery must not clear and refetch ready lyrics");
  } finally { app.cleanup(); }
});

test("sustained empty playback eventually clears lyrics, but never polls every second forever", async () => {
  let emptyPlayback = false, polls = 0;
  const app = harness(async (url) => {
    if (url === "/api/spotify/now-playing") { polls++; return emptyPlayback ? empty() : Response.json(playback()); }
    return Response.json(lyrics());
  });
  try {
    await app.advance(0);
    emptyPlayback = true;
    await app.advance(10_000);
    assert.match(app.text(), /Song first line/);
    await app.advance(6_000);
    assert.doesNotMatch(app.text(), /Song first line/);
    assert.match(app.text(), /Start a song/);
    const before = polls;
    await app.advance(30_000);
    assert.ok(polls - before <= 3, "confirmed idle uses a slower cadence");
    emptyPlayback = false;
    await app.advance(10_000);
    assert.match(active(app), /Song first line/);
  } finally { app.cleanup(); }
});

for (const mode of ["http", "network"]) test(`a transient ${mode} playback failure retries after five seconds, not a minute`, async () => {
  let polls = 0;
  const app = harness(async (url) => {
    if (url === "/api/spotify/now-playing") {
      if (++polls === 2) {
        if (mode === "network") throw new TypeError("Failed to fetch");
        return Response.json({ connected: true, error: "spotify-api-error" }, { status: 502 });
      }
      return Response.json(playback("Song", true, polls > 2 ? 5_000 : 2_000));
    }
    return Response.json(lyrics());
  });
  try {
    await app.advance(0);
    await app.advance(1_000);
    assert.match(active(app), /Song first line/);
    await app.advance(4_999);
    assert.equal(polls, 2);
    await app.advance(1);
    assert.equal(polls, 3);
    assert.match(active(app), /Song second line/);
  } finally { app.cleanup(); }
});

test("a dropped playback sample during a skip recovers the new song without an idle-page detour", async () => {
  let polls = 0;
  const app = harness(async (url) => {
    if (url === "/api/spotify/now-playing") return ++polls === 1 ? Response.json(playback("Alpha")) : polls === 2 ? empty() : Response.json(playback("Beta"));
    return Response.json(lyrics(new URL(url).searchParams.get("track_name")));
  });
  try {
    await app.advance(0);
    await app.advance(1_000);
    assert.doesNotMatch(app.text(), /Start a song/);
    await app.advance(1_000);
    assert.match(app.text(), /Beta first line/);
    assert.doesNotMatch(app.text(), /Alpha first line/);
  } finally { app.cleanup(); }
});

test("a single direct lyric network failure gets one prompt retry without changing the loading panel", async () => {
  let calls = 0;
  const app = harness(async (url) => {
    if (url === "/api/spotify/now-playing") return Response.json(playback());
    if (++calls === 1) throw new TypeError("Failed to fetch");
    return Response.json(lyrics());
  });
  try {
    await app.advance(0);
    assert.match(app.text(), /Finding lyrics/);
    await app.advance(2_999);
    assert.equal(calls, 1);
    await app.advance(1);
    assert.equal(calls, 2);
    assert.match(active(app), /Song first line/);
  } finally { app.cleanup(); }
});

for (const field of ["artist", "durationMs"]) test(`incomplete track ${field} cannot replace an already usable song`, async () => {
  let polls = 0, lyricCalls = 0;
  const app = harness(async (url) => {
    if (url === "/api/spotify/now-playing") {
      const media = playback();
      if (++polls === 2) {
        if (field === "artist") media.item.artist = "";
        else media.item.durationMs = 0;
      }
      return Response.json(media);
    }
    lyricCalls++;
    return Response.json(lyrics());
  });
  try {
    await app.advance(0);
    await app.advance(1_000);
    assert.match(active(app), /Song first line/);
    await app.advance(1_000);
    assert.equal(polls, 3);
    assert.equal(lyricCalls, 1);
  } finally { app.cleanup(); }
});

test("repeated playback failures back off to thirty seconds and reset after recovery", async () => {
  let polls = 0;
  const app = harness(async (url) => {
    if (url !== "/api/spotify/now-playing") return Response.json(lyrics(new URL(url).searchParams.get("track_name")));
    polls++;
    return [1, 6, 8].includes(polls) ? Response.json(playback(polls === 1 ? "Song" : "Recovered"))
      : Response.json({ connected: true, error: "spotify-api-error" }, { status: 502 });
  });
  try {
    await app.advance(0);
    await app.advance(1_000);
    assert.equal(polls, 2);
    for (const delay of [5_000, 10_000, 20_000, 30_000]) {
      const before = polls;
      await app.advance(delay - 1);
      assert.equal(polls, before);
      await app.advance(1);
      assert.equal(polls, before + 1);
    }
    assert.match(app.text(), /Recovered first line/);
    await app.advance(1_000);
    assert.equal(polls, 7);
    await app.advance(5_000);
    assert.equal(polls, 8, "a successful sample resets transient backoff to five seconds");
  } finally { app.cleanup(); }
});

test("fast empty-sample recovery cannot bypass a later Spotify cooldown", async () => {
  let polls = 0;
  const app = harness(async (url) => {
    if (url !== "/api/spotify/now-playing") return Response.json(lyrics());
    polls++;
    if (polls === 2) return empty();
    if (polls === 3) return Response.json({ connected: true, error: "rate-limited", retryAfterSeconds: 60, retryAfterProvided: true }, { status: 429, headers: { "Retry-After": "60" } });
    return Response.json(playback());
  });
  try {
    await app.advance(2_000);
    assert.equal(polls, 3);
    await app.advance(59_999);
    assert.equal(polls, 3);
    await app.advance(1);
    assert.equal(polls, 4);
    assert.match(active(app), /Song first line/);
  } finally { app.cleanup(); }
});
