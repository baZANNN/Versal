import http from "node:http";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTypeScript } from "../tests/load-typescript.mjs";

// Documentation-only component renders. No hooks, credentials, browser storage,
// Spotify calls, LRCLIB calls, or changes to the production app are involved.
const { Topbar } = loadTypeScript("../app/components/topbar.tsx");
const { LyricsPlayer } = loadTypeScript("../app/components/lyrics-player.tsx");
const { DisplaySettings } = loadTypeScript("../app/components/display-settings.tsx");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const noop = () => {};
const text = [
  "Let the quiet city fade",
  "Keep a little light beside you",
  "Every road becomes a rhythm",
  "Let the moment carry you",
  "Leave the noise behind",
  "Find a place beneath the stars",
  "Take the long way home tonight",
];
const lines = text.map((text, index) => ({ time: index * 5, text }));
const scenes = {
  lyrics: { label: "Centered lyrics", visibilityMode: "balanced", fontStyle: "modern", accent: "#d8ff65" },
  daylight: { label: "Daylight visibility", visibilityMode: "daylight", fontStyle: "humanist", accent: "#74dfff" },
  night: { label: "Night visibility", visibilityMode: "night", fontStyle: "editorial", accent: "#c3a6ff", activeUnderline: false },
  settings: { label: "Display options", visibilityMode: "balanced", fontStyle: "rounded", accent: "#ff9f7a", settingsOpen: true },
  untimed: { label: "Untimed lyrics", visibilityMode: "balanced", fontStyle: "mono", accent: "#f4e8d1", plain: true },
};

function renderScene(scene) {
  const preferences = {
    fontScale: 1, focusZoom: 1.45, activeUnderline: true, ...scene,
    setFontScale: noop, setFontStyle: noop, setFocusZoom: noop,
    setActiveUnderline: noop, setAccent: noop, setVisibilityMode: noop,
  };
  const playback = {
    track: { title: "Open Horizon", artist: "Versal Studio", album: "Demo Sessions", source: "Spotify synced", duration: 214 },
    lines: scene.plain ? lines.map((line) => ({ ...line, time: Infinity })) : lines,
    lyricsStatus: scene.plain ? "plain" : "ready", activeIndex: scene.plain ? -1 : 3,
    previousContext: lines.slice(0, 3), upcomingContext: lines.slice(4, 7),
    spotifyConnected: true, spotifyChecked: true, spotifyNow: null, spotifyError: "",
    spotifyRecovering: false, connectionStatus: "Spotify connected", syncing: false,
    spotifyCoolingDown: false, spotifyCooldownRemainingSeconds: 0, forceLyricsSync: noop,
    lyricsLookupPending: false, lyricsLookupCopy: "", lyricsLookupAnnouncement: "",
  };
  return renderToStaticMarkup(createElement("main", {
    className: `app-shell visibility-${preferences.visibilityMode} font-${preferences.fontStyle} active-underline-${preferences.activeUnderline ? "on" : "off"}`,
    style: { "--accent": preferences.accent, "--lyric-scale": preferences.fontScale, "--active-scale": preferences.fontScale * preferences.focusZoom },
  },
  createElement(Topbar, { playback, onOpenConnections: noop, onToggleSettings: noop }),
  scene.settingsOpen && createElement(DisplaySettings, { preferences, onClose: noop }),
  createElement(LyricsPlayer, { playback })));
}

const server = http.createServer((request, response) => {
  const scene = scenes[new URL(request.url, "http://127.0.0.1").searchParams.get("scene") || "lyrics"];
  if (!scene) { response.writeHead(404).end("Unknown showcase scene"); return; }
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Versal — ${scene.label} render</title><style>${css}\n*,*::before,*::after{animation:none!important;transition:none!important}</style><body>${renderScene(scene)}</body></html>`);
});
server.listen(4322, "127.0.0.1", () => console.log("Showcase ready: http://127.0.0.1:4322/"));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close());

