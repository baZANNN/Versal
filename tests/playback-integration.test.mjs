import assert from "node:assert/strict";
import test from "node:test";
import { harness } from "./playback-harness.mjs";

const playback = (id, playing = true, positionMs = 0) => ({ connected: true, playing, positionMs,
  item: { id, type: "track", title: id, artist: "Artist", artists: ["Artist"], collection: "Album", durationMs: 200_000 } });
const lyrics = (title) => [{ id: 1, trackName: title, artistName: "Artist", albumName: "Album", duration: 200,
  instrumental: false, syncedLyrics: `[00:01]${title} first lyric\n[00:04]${title} second lyric`, plainLyrics: null }];

test("untimed lyrics keep their label below song details and outside the scroll region", async () => {
  let song = "Untimed";
  const app = harness(async (url) => {
    if (url === "/api/spotify/now-playing") return Response.json(playback(song));
    const records = lyrics(song);
    if (song === "Untimed") Object.assign(records[0], { syncedLyrics: null, plainLyrics: "First untimed line\nLast untimed line" });
    return Response.json(records);
  });
  try {
    await app.advance(0);
    const player = app.find((node) => node.props?.["aria-label"] === "Lyrics player");
    const content = [player.props.children.props.children].flat(Infinity).filter(Boolean);
    assert.deepEqual(content.map((node) => node.props.className), ["track-info", "plain-lyrics-heading", "lyrics-stage"]);
    const scrollRegion = app.find((node) => node.props?.["aria-label"] === "Untimed lyrics");
    assert.match(app.text(scrollRegion), /First untimed line/);
    assert.match(app.text(scrollRegion), /Last untimed line/);
    assert.doesNotMatch(app.text(scrollRegion), /UNSYNCED LYRICS/);
    song = "Timed";
    await app.advance(1_000);
    assert.doesNotMatch(app.text(), /UNSYNCED LYRICS/);
  } finally { app.cleanup(); }
});

test("lyrics recover automatically after multiple provider cooldowns", async () => {
  let calls = 0;
  const app = harness(async (url) => {
    if (url === "/api/spotify/now-playing") return Response.json(playback("Song"));
    calls++;
    return calls <= 2 ? new Response(null, { status: 429, headers: { "Retry-After": "2" } }) : Response.json(lyrics("Song"));
  });
  try {
    await app.advance(0);
    assert.match(app.text(), /Finding lyrics/);
    await app.advance(1_999);
    assert.equal(calls, 1);
    await app.advance(1);
    assert.equal(calls, 2);
    await app.advance(1_999);
    assert.equal(calls, 2);
    await app.advance(1);
    assert.equal(calls, 3);
    assert.doesNotMatch(app.text(), /Finding lyrics/);
    assert.match(app.text(), /Song first lyric/);
  } finally { app.cleanup(); }
});

test("lookup, cooldown, and retry keep the same Finding lyrics panel below song details", async () => {
  let calls = 0, finish;
  const app = harness(async (url) => {
    if (url === "/api/spotify/now-playing") return Response.json(playback("Song"));
    calls++;
    return new Promise((resolve) => { finish = resolve; });
  });
  const panel = () => app.find((node) => node.props?.className === "lyrics-lookup-panel");
  const structure = () => {
    const player = app.find((node) => node.props?.["aria-label"] === "Lyrics player");
    return [player.props.children.props.children].flat(Infinity).filter(Boolean).map((node) => node.props.className);
  };
  try {
    await app.advance(0);
    assert.match(app.text(panel()), /Finding lyrics/);
    assert.deepEqual(structure(), ["track-info", "lyrics-lookup-panel"]);
    finish(new Response(null, { status: 429, headers: { "Retry-After": "3" } }));
    await app.resolve();
    assert.match(app.text(panel()), /Finding lyrics/);
    const announcement = app.find((node) => node.props?.className === "lyrics-lookup-status").props["aria-label"];
    await app.advance(1_000);
    assert.match(app.text(panel()), /Finding lyrics/);
    assert.equal(app.find((node) => node.props?.className === "lyrics-lookup-status").props["aria-label"], announcement, "the status announcement stays stable during a cooldown");
    assert.equal(calls, 1, "the stable loading state sends no requests");
    await app.advance(2_000);
    assert.equal(calls, 2);
    assert.match(app.text(panel()), /Finding lyrics/);
    assert.deepEqual(structure(), ["track-info", "lyrics-lookup-panel"]);
    assert.doesNotMatch(app.text(), /MATCHING LYRICS|Waiting for the lyrics service|LYRICS SERVICE COOLING DOWN|Retrying in|Waiting to retry/);
    finish(Response.json(lyrics("Song")));
    await app.resolve();
    assert.equal(panel(), undefined);
    assert.match(app.text(), /Song first lyric/);
  } finally { app.cleanup(); }
});

test("an expired retry stays on Finding lyrics while hidden until requests can resume", async () => {
  let calls = 0;
  const app = harness(async (url) => {
    if (url === "/api/spotify/now-playing") return Response.json(playback("Song"));
    calls++;
    return calls === 1 ? new Response(null, { status: 429, headers: { "Retry-After": "2" } }) : Response.json(lyrics("Song"));
  });
  try {
    await app.advance(0);
    await app.hidden(true);
    await app.advance(3_000);
    assert.equal(calls, 1);
    assert.match(app.text(), /Finding lyrics/);
    assert.doesNotMatch(app.text(), /Retrying in|Waiting to retry/);
    await app.hidden(false);
    await app.advance(1_000);
    assert.equal(calls, 2);
    assert.match(app.text(), /Song first lyric/);
  } finally { app.cleanup(); }
});

test("confirmed missing lyrics are not automatically fetched again on playback ticks", async () => {
  let calls = 0;
  const app = harness(async (url) => {
    if (url === "/api/spotify/now-playing") return Response.json(playback("Missing"));
    calls++;
    return Response.json([]);
  });
  try {
    await app.advance(0);
    assert.match(app.text(), /No lyrics found/);
    await app.advance(60_000);
    assert.equal(calls, 1);
  } finally { app.cleanup(); }
});

test("a late previous-song lookup cannot replace the current song's lyrics", async () => {
  let song = "Alpha", finishAlpha;
  const app = harness(async (url) => {
    if (url === "/api/spotify/now-playing") return Response.json(playback(song));
    const title = new URL(url, "http://test").searchParams.get("track");
    return title === "Alpha" ? new Promise((resolve) => { finishAlpha = resolve; }) : Response.json(lyrics(title));
  });
  try {
    await app.advance(0);
    song = "Beta";
    await app.advance(1_000);
    assert.match(app.text(), /Beta first lyric/);
    finishAlpha(Response.json(lyrics("Alpha")));
    await app.resolve();
    assert.match(app.text(), /Beta first lyric/);
    assert.doesNotMatch(app.text(), /Alpha first lyric/);
  } finally { app.cleanup(); }
});

test("active lyric stops advancing after a pause response and clears for podcasts", async () => {
  let media = playback("Song", true, 2_000);
  const app = harness(async (url) => Response.json(url === "/api/spotify/now-playing" ? media : lyrics("Song")));
  try {
    await app.advance(0);
    media = playback("Song", false, 2_500);
    await app.advance(8_000);
    const active = app.find((node) => node.props?.className === "active-lyric-layer");
    assert.ok(active, "active lyric layer remains present");
    assert.match(app.text(active), /Song first lyric/);
    assert.doesNotMatch(app.text(active), /Song second lyric/);
    media = { connected: true, playing: true, item: { type: "episode", title: "Podcast" } };
    await app.advance(3_000);
    assert.doesNotMatch(app.text(), /Song first lyric/);
  } finally { app.cleanup(); }
});

test("returning to the same track cannot revive a superseded lookup", async () => {
  let media = playback("Alpha"), finishOld;
  const app = harness(async (url) => {
    if (url === "/api/spotify/now-playing") return Response.json(media);
    const params = new URL(url, "http://test").searchParams;
    if (params.get("track") === "Alpha" && params.get("album") === "Album") {
      return new Promise((resolve) => { finishOld = resolve; });
    }
    return Response.json(lyrics(params.get("track")));
  });
  try {
    await app.advance(0);
    media = playback("Beta"); await app.advance(1_000);
    media = playback("Alpha"); media.item.collection = "Revised album";
    await app.advance(1_000);
    assert.match(app.text(), /Revised album/);
    finishOld(Response.json(lyrics("Alpha")));
    await app.resolve();
    assert.match(app.text(), /Revised album/);
    assert.match(app.text(), /Alpha first lyric/);
  } finally { app.cleanup(); }
});

test("refresh and visibility changes cannot bypass Spotify's Retry-After", async () => {
  let calls = 0;
  const app = harness(async (url) => {
    if (url !== "/api/spotify/now-playing") return Response.json(lyrics("Song"));
    calls++;
    return calls === 1 ? Response.json(playback("Song")) : Response.json({ connected: true, error: "rate-limited", retryAfterSeconds: 120, retryAfterProvided: true }, { status: 429, headers: { "Retry-After": "120" } });
  });
  try {
    await app.advance(0);
    await app.clickRefresh();
    assert.equal(calls, 1, "same-second refresh is coalesced");
    await app.advance(1_000);
    assert.equal(calls, 2);
    await app.hidden(true); await app.advance(30_000);
    await app.hidden(false); await app.advance(30_000);
    assert.equal(calls, 2, "no requests during persisted cooldown");
    await app.advance(60_001);
    assert.equal(calls, 3, "polling resumes only after the full deadline");
  } finally { app.cleanup(); }
});

test("repeated one-second cooldowns back off and stop; refresh can recover the same song", async () => {
  let calls = 0, recover = false;
  const app = harness(async (url) => {
    if (url === "/api/spotify/now-playing") return Response.json(playback("Song"));
    calls++;
    return recover ? Response.json(lyrics("Song")) : new Response(null, { status: 429, headers: { "Retry-After": "1" } });
  });
  try {
    await app.advance(0);
    assert.equal(calls, 1);
    for (const delay of [1_000, 2_000, 4_000, 8_000, 16_000]) {
      await app.advance(delay - 1);
      const before = calls;
      await app.advance(1);
      assert.equal(calls, before + 1);
    }
    assert.equal(calls, 6);
    assert.match(app.text(), /Tap ↻ to retry/);
    await app.advance(60_000);
    assert.equal(calls, 6, "playback ticks must not restart an exhausted retry chain");
    recover = true;
    await app.clickRefresh();
    assert.equal(calls, 7);
    assert.match(app.text(), /Song first lyric/);
  } finally { app.cleanup(); }
});

test("a transient 503 recovers only after its provider deadline", async () => {
  let calls = 0;
  const app = harness(async (url) => {
    if (url === "/api/spotify/now-playing") return Response.json(playback("Song"));
    calls++;
    return calls === 1 ? new Response(null, { status: 503, headers: { "Retry-After": "60" } }) : Response.json(lyrics("Song"));
  });
  try {
    await app.advance(0);
    assert.match(app.text(), /Finding lyrics/);
    await app.advance(59_999);
    assert.equal(calls, 1);
    await app.advance(1);
    assert.equal(calls, 2);
    assert.match(app.text(), /Song first lyric/);
  } finally { app.cleanup(); }
});

test("a song change aborts the superseded browser lyric request", async () => {
  let song = "Alpha", signal;
  const app = harness(async (url, options) => {
    if (url === "/api/spotify/now-playing") return Response.json(playback(song));
    if (new URL(url, "http://test").searchParams.get("track") === "Alpha") {
      signal = options.signal;
      return new Promise(() => {});
    }
    return Response.json(lyrics(song));
  });
  try {
    await app.advance(0);
    assert.equal(signal.aborted, false);
    song = "Beta";
    await app.advance(1_000);
    assert.equal(signal.aborted, true);
    assert.match(app.text(), /Beta first lyric/);
  } finally { app.cleanup(); }
});

