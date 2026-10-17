import type { SpotifyPlayback } from "../hooks/use-spotify-playback";

/** Presentational only: changing this markup must not schedule network work. */
export function LyricsPlayer({ playback }: { playback: SpotifyPlayback }) {
  const {
    track,
    lines,
    lyricsStatus,
    activeIndex,
    previousContext,
    upcomingContext,
    spotifyConnected,
    spotifyChecked,
    spotifyNow,
    spotifyError,
    spotifyRecovering,
    recoveryEyebrow,
    recoveryHeading,
    recoveryCopy,
    lyricsLookupPending,
    lyricsLookupCopy,
    lyricsLookupAnnouncement,
  } = playback;
  return (
    <section className={spotifyConnected ? "player" : "player connection-player"} aria-label={spotifyConnected ? "Lyrics player" : "Spotify connection required"}>
      {!spotifyChecked ? (
        <div className="connection-gate checking"><span className="spotify-orbit" /><p>Checking Spotify connection…</p></div>
      ) : !spotifyConnected ? (
        <div className="connection-gate">
          <div className="spotify-gate-brand"><span className="spotify-dot" />Spotify</div>
          <p className="eyebrow">CONNECTION REQUIRED</p>
          <h1>Connect Spotify to begin</h1>
          <p>Connect your Spotify account to follow your music with synchronized lyrics.</p>
          {spotifyError && <p className="error-message">{spotifyError}</p>}
          <a className="spotify-wide gate-button" href="/api/spotify/connect">Connect Spotify</a>
          <small>Versal follows the song playing on your Spotify account automatically.</small>
        </div>
      ) : (
        <>
          {track.title && (
            <div className="track-info">
              <div className="track-copy"><h1>{track.title}</h1><p className="artist">{track.artist}{track.album && <span> · {track.album}</span>}</p></div>
            </div>
          )}

          {lyricsStatus === "plain" && lines.length > 0 && (
            <div className="plain-lyrics-heading"><p className="eyebrow">UNSYNCED LYRICS</p><span>Timing is not available for this track</span></div>
          )}

          {lines.length > 0 ? (
            <div className="lyrics-stage">
              {lyricsStatus === "plain" ? (
                <div className="plain-lyrics" role="region" aria-label="Untimed lyrics">
                  <div className="plain-lyrics-copy">{lines.map((line, index) => <p key={`${line.text}-${index}`}>{line.text}</p>)}</div>
                </div>
              ) : activeIndex < 0 ? (
                <div className="idle-lyrics" aria-hidden="true">
                  {lines.slice(0, 9).map((line, index) => <p className="idle-lyric" key={`${line.time}-${index}`}>{line.text}</p>)}
                </div>
              ) : (
                <>
                  <div className="context-zone previous-context" aria-hidden="true" key={`previous-${activeIndex}`}>
                    {previousContext.map((line, index) => <p className={`context-line distance-${Math.min(previousContext.length - index, 3)}`} key={`${line.time}-${index}`}>{line.text}</p>)}
                  </div>
                  <div className="context-zone upcoming-context" aria-hidden="true" key={`upcoming-${activeIndex}`}>
                    {upcomingContext.map((line, index) => <p className={`context-line distance-${Math.min(index + 1, 3)}`} key={`${line.time}-${index}`}>{line.text}</p>)}
                  </div>
                  <div className="active-lyric-layer" aria-live="polite" aria-atomic="true">
                    <p className="lyric active overlay-line" key={`${activeIndex}-${lines[activeIndex].time}`}>{lines[activeIndex].text}</p>
                  </div>
                </>
              )}
            </div>
          ) : lyricsLookupPending ? (
            <div className="lyrics-lookup-panel">
              <p className="lyrics-lookup-status" role="status" aria-label={lyricsLookupAnnouncement}>
                <span aria-hidden="true">{lyricsLookupCopy}</span>
              </p>
            </div>
          ) : (
            <div className="real-music-empty">
              <p className="eyebrow">{lyricsStatus === "instrumental" ? "INSTRUMENTAL" : lyricsStatus === "missing" ? "LYRICS UNAVAILABLE" : spotifyRecovering ? recoveryEyebrow : "READY"}</p>
              <h2>{lyricsStatus === "instrumental" ? "Instrumental track" : spotifyRecovering ? recoveryHeading : lyricsStatus === "missing" ? "No lyrics found" : spotifyNow ? spotifyNow.title : "Start a song to continue"}</h2>
              <p>{lyricsStatus === "instrumental" ? "There are no vocal lines to display for this track." : spotifyRecovering ? recoveryCopy : lyricsStatus === "missing" ? "Versal could not find a reliable lyric match for this song." : spotifyNow?.type === "episode" ? "Synchronized lyrics are available for music tracks." : "Versal will automatically follow the song playing in Spotify."}</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
