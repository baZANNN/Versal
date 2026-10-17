import type { SpotifyPlayback } from "../hooks/use-spotify-playback";
import { formatDuration } from "../lib/format-duration";

export function Topbar({ playback, onOpenConnections, onToggleSettings }: {
  playback: SpotifyPlayback; onOpenConnections: () => void; onToggleSettings: () => void;
}) {
  const {
    spotifyRecovering,
    connectionStatus,
    spotifyConnected,
    syncing,
    forceLyricsSync,
    spotifyCoolingDown,
    spotifyCooldownRemainingSeconds,
  } = playback;
  return (
    <header className="topbar">
      <a className="brand" href="/" aria-label="Versal home"><span className="brand-mark">V</span><span>Versal</span></a>
      <div className="header-actions">
        <button className={`icon-button connection-button${spotifyRecovering ? " connection-warning" : ""}`} onClick={() => onOpenConnections()} aria-label={`Open connections. ${connectionStatus}`} title={connectionStatus}><span /></button>
        {spotifyConnected && <button className={`icon-button sync-button${syncing ? " syncing" : ""}`} onClick={forceLyricsSync} disabled={syncing || spotifyCoolingDown} aria-label={spotifyCoolingDown ? `Spotify is cooling down. Next check in ${formatDuration(spotifyCooldownRemainingSeconds)}` : syncing ? "Re-syncing lyrics to Spotify" : "Re-sync lyrics to Spotify"} title={spotifyCoolingDown ? `Next Spotify check in ${formatDuration(spotifyCooldownRemainingSeconds)}` : "Re-sync lyrics to Spotify"}>↻</button>}
        {spotifyConnected && <button className="icon-button" onClick={() => onToggleSettings()} aria-label="Open display settings">Aa</button>}
      </div>
    </header>
  );
}
