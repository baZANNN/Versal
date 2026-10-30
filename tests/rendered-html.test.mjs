import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Versal application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Versal — Synchronized lyrics for every screen<\/title>/i);
  assert.match(html, /aria-label="Versal home"/);
  assert.match(html, /Checking Spotify connection/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|Building your site/i);
});

test("keeps Daylight crisp and playback detection responsive", async () => {
  const [page, css] = await Promise.all([
    Promise.all([
      "page.tsx", "lib/client-config.ts", "lib/client-types.ts",
      "hooks/use-spotify-playback.ts", "components/display-settings.tsx", "components/lyrics-player.tsx",
    ].map((path) => readFile(new URL(`../app/${path}`, import.meta.url), "utf8"))).then((sources) => sources.join("\n")),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /SPOTIFY_PLAYING_POLL_MS = 3_000/);
  assert.match(page, /SPOTIFY_PAUSED_POLL_MS = 3_000/);
  assert.match(page, /SPOTIFY_TRANSITION_POLL_MS = 1_000/);
  assert.match(page, /SPOTIFY_IDLE_POLL_MS = 10_000/);
  assert.match(page, /SPOTIFY_LEADER_LEASE_MS = 45_000/);
  assert.match(page, /remainingMs \+ 500/);
  assert.match(page, /LYRICS_RETRY_DELAY_MS = 3_000/);
  assert.match(page, /LYRICS_MAX_AUTOMATIC_RETRIES = 3/);
  assert.match(page, /type FontStyle = "modern" \| "editorial" \| "rounded" \| "humanist" \| "mono"/);
  assert.match(page, /FONT_STYLES\.map/);
  assert.match(page, /font-\$\{fontStyle\}/);
  assert.match(page, /lyricsStatus === "plain"/);
  assert.match(page, /UNSYNCED LYRICS/);
  assert.match(page, /response\.headers\.get\("Retry-After"\)/);
  assert.match(css, /Daylight prioritizes hard edges and contrast over atmospheric glow/);
  assert.match(css, /\.visibility-daylight \.lyric\.active\{[\s\S]*?filter:none;[\s\S]*?text-shadow:0 2px 0/);
  assert.match(css, /\.visibility-daylight \.active-lyric-layer::before\{[\s\S]*?backdrop-filter:none;/);
  assert.match(css, /\.visibility-daylight \.active-lyric-layer::before\{[\s\S]*?rgba\(5,7,6,\.76\)[\s\S]*?mask-image:linear-gradient\(transparent,#000 34%,#000 66%,transparent\);[\s\S]*?box-shadow:none/);
  assert.match(css, /\.font-editorial\{--display-font:Georgia/);
  assert.match(css, /\.font-rounded\{--display-font:"Trebuchet MS"/);
  assert.match(css, /\.font-humanist\{--display-font:Candara/);
  assert.match(css, /\.font-mono\{--display-font:ui-monospace/);
});
