import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScript } from "./load-typescript.mjs";

function route(upstream) {
  const logs = [];
  const { GET } = loadTypeScript("../app/api/spotify/now-playing/route.ts", {
    "next/server": { NextResponse: { json(body, init) { const response = Response.json(body, init); response.cookies = { set() {} }; return response; } } },
    "../../../lib/spotify": { validSpotifySession: async () => ({ session: { accessToken: "synthetic-test-token" }, changed: false }),
      persistSpotifySession: async () => {}, SpotifyRefreshError: class extends Error {} },
  }, { fetch: async () => upstream.clone(), console: { info: (message) => logs.push(JSON.parse(message)) } });
  return { GET, logs };
}

test("Spotify 204 stays distinguishable in privacy-safe diagnostics", async () => {
  const { GET, logs } = route(new Response(null, { status: 204 }));
  const response = await GET({});
  assert.deepEqual(await response.json(), { connected: true, playing: false, item: null });
  assert.deepEqual(logs, [{ event: "spotify_playback_empty", upstreamStatus: 204, itemPresent: false }]);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
});

test("missing Spotify titles, artists, or duration produce incomplete samples rather than invented tracks", async () => {
  for (const item of [{ id: "test", type: "track", duration_ms: 200_000, artists: [{ name: "Test artist" }] },
    { id: "test", type: "track", name: "Test song", duration_ms: 200_000, artists: [] },
    { id: "test", type: "track", name: "Test song", duration_ms: 0, artists: [{ name: "Test artist" }] }]) {
    const { GET, logs } = route(Response.json({ is_playing: true, item }));
    assert.equal((await (await GET({})).json()).item, null);
    assert.equal(logs[0].event, "spotify_playback_empty");
    assert.doesNotMatch(JSON.stringify(logs), /Test artist|Test song|synthetic-test-token|"id"/);
  }
});

test("complete Spotify tracks are unchanged and do not generate empty-playback diagnostics", async () => {
  const { GET, logs } = route(Response.json({ is_playing: true, progress_ms: 12_000,
    item: { id: "test", type: "track", name: "Test song", duration_ms: 200_000, artists: [{ name: "Test artist" }], album: { name: "Test album" } } }));
  const sample = await (await GET({})).json();
  assert.equal(sample.playing, true);
  assert.equal(sample.positionMs, 12_000);
  assert.equal(sample.item.title, "Test song");
  assert.equal(sample.item.artist, "Test artist");
  assert.deepEqual(logs, []);
});
