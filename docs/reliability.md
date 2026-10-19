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
  There is a 300 ms pause before that fallback, following LRCLIB's request-spacing
  guidance. No third broad search is sent for a song. Any rate limit or provider
  outage ends the sequence immediately.
- In-flight requests are shared. Successful results remain cached for thirty
  minutes (up to fifty entries); empty results expire after five minutes.
- Each song lookup has a generation guard, including A → B → A transitions.
  An old response cannot replace the latest song's metadata or lyrics. Superseded
  browser requests are aborted. An aborted pending request is not reused when
  returning to the same song; completed cached results retain their normal TTL.
- Transient failures without a provider deadline receive at most one automatic
  retry per lookup. Invalid requests, confirmed misses, and authentication failures
  are not automatically retried. Both 429 and 503 Retry-After deadlines survive
  the proxy and are honored by the browser, including manual refresh and reloads.
  A provider deadline allows at most five automatic retries for the current song.
  Short repeated waits also use a 1, 2, 4, 8, then 16-second delay, always waiting
  longer if the provider requires it. This bounds a one-second retry storm while
  still allowing recovery. After exhaustion, the status says to tap the existing
  refresh control; a new track or manual refresh starts a new bounded chain.
  Playback polling never silently restarts an exhausted chain.
  The server honors valid provider deadlines without additional backoff.
  Only missing/invalid Retry-After values use 30, 60, 120, 240, then 300 seconds of
  fallback backoff. The browser treats the server deadline as the minimum wait;
  it does not multiply long provider waits or impose the ordinary 12-second
  network-retry delay on a brief provider deadline. Existing persisted
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

The October 18 comparison used reference tree
`37c2097347f720a7b0170c7d3d7f7d1c19d035fc`. Both applications fetch lyrics on
the server. The reference keeps completed lyric promises, including misses, for
the browser session instead of issuing an unlimited automatic network retry loop.
Versal retains its bounded cache and structured fallback, with bounded recovery
and cancellation of superseded browser requests. A live diagnostic also observed
LRCLIB returning 503 with Retry-After, then succeeding on a later request; such a
response must not be flattened to a generic 502 with its deadline discarded.

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

