"use client";

import { useState, type CSSProperties } from "react";
import { useSpotifyPlayback } from "./hooks/use-spotify-playback";
import { useDisplayPreferences } from "./hooks/use-display-preferences";
import { Topbar } from "./components/topbar";
import { DisplaySettings } from "./components/display-settings";
import { LyricsPlayer } from "./components/lyrics-player";
import { ConnectionDialog } from "./components/connection-dialog";

export default function Home() {
  const preferences = useDisplayPreferences();
  const playback = useSpotifyPlayback();
  const [setupOpen, setSetupOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { visibilityMode, fontStyle, activeUnderline, accent, fontScale, focusZoom } = preferences;

  return (
    <main className={`app-shell visibility-${visibilityMode} font-${fontStyle} active-underline-${activeUnderline ? "on" : "off"}`} style={{ "--accent": accent, "--lyric-scale": fontScale, "--active-scale": fontScale * focusZoom } as CSSProperties}>
      <Topbar playback={playback} onOpenConnections={() => setSetupOpen(true)} onToggleSettings={() => setSettingsOpen(!settingsOpen)} />
      {settingsOpen && <DisplaySettings preferences={preferences} onClose={() => setSettingsOpen(false)} />}
      <LyricsPlayer playback={playback} />
      {setupOpen && <ConnectionDialog playback={playback} onClose={() => setSetupOpen(false)} />}
    </main>
  );
}
