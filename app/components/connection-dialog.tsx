import type { SpotifyPlayback } from "../hooks/use-spotify-playback";

export function ConnectionDialog({ playback, onClose }: { playback: SpotifyPlayback; onClose: () => void }) {
  const {
    spotifyConnected,
    spotifyRecovering,
    spotifyAvailability,
    spotifyError,
    spotifyCoolingDown,
    spotifyCooldownDetail,
    disconnectSpotify,
  } = playback;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && onClose()}>
      <section className="modal setup-modal" role="dialog" aria-modal="true" aria-labelledby="setup-title">
        <div className="modal-heading"><div><p className="eyebrow">READ-ONLY CONNECTION</p><h2 id="setup-title">Spotify connection</h2></div><button className="close-button" onClick={() => onClose()} aria-label="Close">×</button></div>
        <p className="lead">Spotify identifies the current song and keeps the lyrics aligned with its playback position. Your Spotify password is entered only on Spotify.</p>
        <div className="connection-list">
          <article className="connection-card spotify-connection">
            <div className="connection-heading"><div><strong>Spotify</strong><span>Identify the song and find its lyrics</span></div><em className={spotifyConnected ? spotifyRecovering ? "warning" : "connected" : ""}>{spotifyConnected ? spotifyAvailability === "quota-exceeded" ? "Limit reached" : spotifyAvailability === "rate-limited" ? "Cooling down" : spotifyAvailability === "unavailable" ? "Reconnecting" : "Connected" : "Not connected"}</em></div>
            {spotifyError && <p className="error-message">{spotifyError}</p>}
            {spotifyCoolingDown && spotifyCooldownDetail && <p><strong>{spotifyCooldownDetail}</strong></p>}
            <p>Requests only “currently playing” access. The title, artist, duration, and playback position keep the matching lyrics aligned.</p>
            {spotifyConnected ? <button className="secondary-wide" onClick={disconnectSpotify}>Disconnect Spotify</button> : <a className="spotify-wide" href="/api/spotify/connect">Connect Spotify</a>}
          </article>
        </div>
        <button className="text-wide" onClick={() => onClose()}>Close</button>
      </section>
    </div>
  );
}
