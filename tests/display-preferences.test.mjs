import assert from "node:assert/strict";
import test from "node:test";
import { harness } from "./playback-harness.mjs";

const key = "roadverse-display-preferences-v1";
const storedPreferences = {
  fontScale: 1.18, fontStyle: "editorial", focusZoom: 1.25,
  activeUnderline: false, accent: "#74dfff", visibilityMode: "daylight",
};
const connected = () => Response.json({ connected: true, playing: false, item: null });
const main = (app) => app.find((node) => node.type === "main");
const clickLabel = (app, label) => app.click((node) => node.props?.["aria-label"] === label);

test("saved fonts, scale, underline, palette, and visibility survive a remount", async () => {
  const app = harness(connected, { storageEntries: [[key, JSON.stringify(storedPreferences)]] });
  try {
    await app.advance(0);
    assert.match(main(app).props.className, /visibility-daylight font-editorial active-underline-off/);
    assert.equal(main(app).props.style["--accent"], storedPreferences.accent);
    assert.equal(main(app).props.style["--lyric-scale"], storedPreferences.fontScale);
    assert.equal(main(app).props.style["--active-scale"], 1.18 * 1.25);
    assert.deepEqual(JSON.parse(app.storage.get(key)), storedPreferences);
    await clickLabel(app, "Open display settings");
    await app.click((node) => node.type === "button" && app.text(node) === "Mono");
    await clickLabel(app, "Use Sunset coral theme");
    await app.resolve();
    const saved = app.storage.get(key);
    assert.equal(JSON.parse(saved).fontStyle, "mono");
    const reloaded = harness(connected, { storageEntries: [[key, saved]] });
    try {
      await reloaded.advance(0);
      assert.match(main(reloaded).props.className, /font-mono/);
      assert.equal(main(reloaded).props.style["--accent"], "#ff9f7a");
    } finally { reloaded.cleanup(); }
  } finally { app.cleanup(); }
});

test("malformed or unsupported saved preferences fall back to safe defaults", async () => {
  for (const saved of ["not-json", JSON.stringify({ fontStyle: "unknown", fontScale: 900, accent: "invalid", visibilityMode: "unknown" })]) {
    const app = harness(connected, { storageEntries: [[key, saved]] });
    try {
      await app.advance(0);
      assert.match(main(app).props.className, /visibility-balanced font-modern active-underline-on/);
      assert.equal(main(app).props.style["--lyric-scale"], 1);
      assert.equal(main(app).props.style["--accent"], "#d8ff65");
    } finally { app.cleanup(); }
  }
});

test("opening and changing display controls does not create extra playback requests", async () => {
  let requests = 0;
  const app = harness(async () => { requests++; return connected(); });
  try {
    await app.advance(0);
    await clickLabel(app, "Open display settings");
    await app.click((node) => node.type === "button" && app.text(node) === "Large");
    await app.click((node) => node.type === "button" && app.text(node) === "Daylight");
    await clickLabel(app, "Close settings");
    assert.equal(requests, 1);
  } finally { app.cleanup(); }
});

test("unmount releases playback leadership and cancels scheduled lyric retries", async () => {
  let requests = 0;
  const app = harness(async (url) => {
    requests++;
    if (url === "/api/spotify/now-playing") return Response.json({
      connected: true, playing: true, positionMs: 0,
      item: { id: "test", type: "track", title: "Test", artist: "Artist", artists: ["Artist"], collection: "Album", durationMs: 60_000 },
    });
    return new Response(null, { status: 429, headers: { "Retry-After": "2" } });
  });
  await app.advance(0);
  assert.equal(requests, 2);
  app.cleanup();
  assert.equal(app.storage.has("roadverse-spotify-poll-leader-v1"), false);
  await app.advance(60_000);
  assert.equal(requests, 2);
});
