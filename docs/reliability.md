# Versal playback and lyrics

Versal remains a Spotify-only lyrics display. Its centered active-line layer,
context lines, palettes, fonts, and persistent display preferences are independent
of the playback and lookup helpers. This reliability pass does not change CSS.

## Playback

- Visible, connected playback is checked every three seconds, including pauses.
  Two brief one-second checks follow a detected track/play-state transition; an
  additional check is scheduled near the known track end.
- External skips and pauses are discovered by polling, not push notifications.
  Three seconds is a scheduling target, not a guaranteed latency bound: network
  delays, Spotify state propagation, and provider cooldowns can extend it.
- Animation uses elapsed monotonic time from the last playback sample. Both
  ahead and behind errors are corrected; paused playback does not advance.
  Extrapolation stops after ten seconds without a new sample.
- Hidden/offline pages do not initiate playback polls. Visible tabs in the same
  browser share playback snapshots and a leadership lease. Different devices
  still make independent requests; this is not an application-wide quota gate.
- Spotify Retry-After deadlines persist in browser storage and survive reloads.
  Refresh, visibility changes, and network recovery cannot shorten them.
- Transient refresh-token failures trigger recovery, not a false sign-out.
  A revoked refresh token still requires reconnecting Spotify.

## Lyrics

- Lookup and cooldown share one stable status slot below the song metadata.
  The countdown is display-only: it does not initiate requests or alter retry
  deadlines. At expiry while hidden/offline it says "Waiting to retry" until
  the existing scheduler can proceed. Active lyrics and their layout are unchanged.

- One exact LRCLIB lookup precedes at most one structured search when needed.
  No third broad search is sent for a song. Any rate limit or provider outage
  ends the sequence immediately.
- In-flight requests are shared. Successful results remain cached for thirty
  minutes (up to fifty entries); empty results expire after five minutes.
- Each song lookup has a generation guard, including A → B → A transitions.
  An old response cannot replace the latest song's metadata or lyrics.
- Transient non-throttle failures receive at most one automatic retry per lookup;
  confirmed misses and authentication failures are not automatically retried. Provider
  429s resume after each cooldown instead of exhausting that retry and getting
  stuck. Retry-After persists across reloads and cannot be bypassed with manual
  refresh. The server honors valid provider deadlines without additional backoff.
  Only missing/invalid Retry-After values use 30, 60, 120, 240, then 300 seconds of
  fallback backoff. The browser follows the server deadline without multiplying
  it or imposing the ordinary 12-second network-retry delay. Existing persisted
  deadlines from older releases are retained because their provenance is unknown.
- Structured lyrics_cooldown logs distinguish actual upstream 429s from a local
  cooldown gate. Upstream entries include the original Retry-After (bounded to
  128 characters), parsed deadline, effective wait, and provider/fallback source.
  They contain no song metadata, listener identity, cookies, or tokens.
- A bounded per-Worker cache shares successful lyrics and in-flight lookups, and
  gates new lookups during provider cooldowns. It retains at most fifty results
  and 500,000 text characters for thirty minutes (empty results: five minutes).
  This is best-effort isolate-local protection, not a durable or global quota gate.
- Empty exact records still receive one structured fallback; unrelated results
  are treated as a miss. Requests identify Versal with a User-Agent and retain the fractional
  track duration, as the reference viewer does.
- Repeated/unsorted timestamps, offset tags, and simultaneous lines are parsed.
  Non-Latin metadata is preserved for matching. Untimed lyrics stay explicitly
  untimed; the app does not fabricate activation timing.

## Reference comparison

[spotify-lyrics-viewer](https://github.com/brentvollebregt/spotify-lyrics-viewer)
uses periodic playback checks, track-end checks, a local progress clock, and cached
lyric promises with cancellation guards. Its source defaults to a one-second
playback-check delay (configurable by deployment). Versal deliberately retains its
more conservative three-second regular cadence given the account's rate-limit
history, while adopting the same useful separation of playback, lookup, and display.
Its optional Genius fallback was not copied: it adds service dependencies and
cannot supply missing line timestamps. LRCLIB remains Versal's lyrics source.

## Validation

`npm test` builds and runs the application-shell, clock, parser, provider, and
component-effect tests. All playback/provider tests use invented song data and
mocked requests; they do not consume Spotify quota or prove audible alignment in
a physical vehicle. The component tests cover delayed song responses, A → B → A,
pauses, podcasts, repeated refresh, hidden tabs, and cooldown expiry.

The build scripts use a Node wrapper to work in PowerShell and POSIX shells.
`npm run typecheck:client` checks the page, extracted hooks/components, and their
imported libraries without including downloaded reference code or Worker types.
The starter's repository-wide TypeScript configuration lacks a
`cloudflare:workers` ambient declaration. Only the scoped client check is claimed;
production build and Worker-render tests provide separate validation.
