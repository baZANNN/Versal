import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTypeScript } from "./load-typescript.mjs";

const { Topbar } = loadTypeScript("../app/components/topbar.tsx");
const { FONT_STYLES } = loadTypeScript("../app/lib/client-config.ts");
const playback = (overrides = {}) => ({ spotifyConnected: true, spotifyRecovering: false,
  connectionStatus: "Spotify connected", syncing: false, spotifyCoolingDown: false,
  spotifyCooldownRemainingSeconds: 60, forceLyricsSync() {}, ...overrides });
const render = (model = playback(), font = "modern") => renderToStaticMarkup(createElement("div", { className: `app-shell font-${font}` },
  createElement(Topbar, { playback: model, onOpenConnections() {}, onToggleSettings() {} })));
const refresh = (html) => html.match(/<button[^>]*class="[^"]*sync-button[^"]*"[\s\S]*?<\/button>/)?.[0];

test("every typeface renders the same explicitly sized vector refresh icon, not a font glyph", () => {
  let firstIcon;
  for (const { value } of FONT_STYLES) {
    const button = refresh(render(playback(), value));
    assert.ok(button);
    assert.match(button, /aria-label="Re-sync lyrics to Spotify"/);
    assert.match(button, /<svg[^>]*width="22"[^>]*height="22"[^>]*viewBox="0 0 24 24"/);
    assert.match(button, /stroke="currentColor"/);
    assert.match(button, /aria-hidden="true" focusable="false"/);
    assert.equal((button.match(/<path /g) || []).length, 2);
    assert.doesNotMatch(button, /↻|⟳|<text\b/);
    const icon = button.match(/<svg[\s\S]*?<\/svg>/)[0];
    firstIcon ??= icon;
    assert.equal(icon, firstIcon);
  }
});

test("refresh retains its handler and accessible busy/cooldown states", () => {
  let calls = 0;
  const forceLyricsSync = () => { calls++; };
  const model = playback({ forceLyricsSync });
  const header = Topbar({ playback: model, onOpenConnections() {}, onToggleSettings() {} });
  const button = header.props.children[1].props.children.find((node) => node?.props?.className?.includes("sync-button"));
  assert.equal(button.props.onClick, forceLyricsSync);
  button.props.onClick();
  assert.equal(calls, 1);
  for (const state of [{ syncing: true }, { spotifyCoolingDown: true }]) {
    const html = refresh(render(playback(state)));
    assert.match(html, /disabled=""/);
    assert.match(html, /<svg/);
    assert.match(html, state.syncing ? /Re-syncing lyrics to Spotify/ : /Spotify is cooling down/);
  }
});

test("only the vector spins, with reduced-motion support; the button frame stays fixed", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.sync-icon\{display:block;width:22px;height:22px;/);
  assert.match(css, /\.sync-button\.syncing \.sync-icon\{animation:manual-sync-spin/);
  assert.doesNotMatch(css, /\.sync-button\.syncing\{[^}]*animation:/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{\.sync-button\.syncing \.sync-icon\{animation:none\}\}/);
});
