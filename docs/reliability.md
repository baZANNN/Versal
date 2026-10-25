# Versal playback and lyrics

Versal remains a Spotify-only lyrics display. Its centered active-line layer,
context lines, palettes, fonts, and persistent display preferences are independent
of the playback and lookup helpers. Icon compatibility fixes do not change lyric styling.

The refresh control uses an explicitly sized inline SVG, not a font character, so
all display typefaces share the same icon. Only the arrow rotates while syncing;
the button frame stays fixed, and reduced-motion preferences disable rotation.

## Playback

- Visible, connected playback is checked every three seconds, including pauses.
  Two brief one-second checks follow a detected track/play-state transition; an
  additional check is scheduled near the known track end.
- An empty or incomplete Spotify sample is not immediately treated as a stopped
  session. For twelve seconds, the previous song and lyrics remain available but
  their clock is frozen. Two one-second recovery checks are followed by normal
  three-second checks. Consistent empty playback then clears the song and checks
  every ten seconds; a confirmed podcast clears music lyrics immediately.
- Temporary playback HTTP/network failures retry after 5, 10, 20, then at most
  30 seconds, resetting after a successful sample. They no longer impose a
  one-minute blind spot after a single failure. Provider-requested cooldowns and
  sign-in failures remain separate and cannot be bypassed by these checks.
- Empty upstream responses produce `spotify_playback_empty` server logs with
  status, item presence, type, and metadata-presence booleans only. Track names,
  artists, IDs, account details, and tokens are not logged. Incomplete tracks are
  normalized to empty samples, not invented `Unknown title` lyric lookups.
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

- The browser requests LRCLIB's documented public CORS API directly. Spotify OAuth,
  token refresh, encrypted cookies, and playback requests remain server-side.
  Lyric requests send only song metadata, `Lrclib-Client`, and `Accept`; credentials
  are omitted and the referrer is suppressed. LRCLIB sees the requesting device's
  network address, as with other direct browser requests. It may still throttle
  that connection; this transport is not a guarantee against provider outages.
- The existing `/api/lyrics/search?...` string remains a stable song/cache key in
  the loader, but the browser adapter does not fetch it. The authenticated Worker
  endpoint is retained for compatibility and rollback. There is deliberately no
  automatic direct/proxy failover after a throttle, outage, or CORS error. Existing
  persisted cooldowns are honored when moving to this transport, not cleared.
- Direct and server lookups use the same matching/fallback helper. The default
  display and three-second Spotify cadence are unchanged. Direct results use the
  browser's fifty-entry cache; they do not populate or benefit from the Worker
  cache. Separate devices/tabs can therefore make independent lyric requests.

- Lookup, cooldown, and automatic retries share one stable "Finding lyrics…"
  status below the song metadata. Retry deadlines and hidden/offline checks stay
  behind the scenes; there is no display countdown or extra display timer. Only
  completed outcomes, including an exhausted retry chain, replace this message.
  Active lyrics and their layout are unchanged.

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
  retry after three seconds per lookup (previously twelve seconds). Invalid
  requests, confirmed misses, and authentication failures
  are not automatically retried. Both 429 and 503 Retry-After deadlines are
  honored by the browser, including manual refresh and reloads. The retained
  server endpoint also preserves them.
  A provider deadline allows at most five automatic retries for the current song.
  Short repeated waits also use a 1, 2, 4, 8, then 16-second delay, always waiting
  longer if the provider requires it. This bounds a one-second retry storm while
  still allowing recovery. After exhaustion, the status says to tap the existing
  refresh control; a new track or manual refresh starts a new bounded chain.
  Playback polling never silently restarts an exhausted chain.
  The server honors valid provider deadlines without additional backoff.
  Only missing/invalid Retry-After values use 30, 60, 120, 240, then 300 seconds of
  fallback backoff. Direct browser requests use the same fallback sequence when
  a 429 has no usable deadline. The browser treats any deadline as the minimum wait;
  it does not multiply long provider waits or impose the ordinary three-second
  network-retry delay on a brief provider deadline. Existing persisted
  deadlines from older releases are retained because their provenance is unknown.
- For the retained server endpoint, structured lyrics_cooldown logs distinguish actual upstream 429s from a local
  cooldown gate. Upstream entries include the original Retry-After (bounded to
  128 characters), parsed deadline, effective wait, and provider/fallback source.
  They contain no song metadata, listener identity, cookies, or tokens.
- The retained server endpoint's bounded per-Worker cache shares successful lyrics and in-flight lookups, and
  gates new lookups during provider cooldowns. It retains at most fifty results
  and 500,000 text characters for thirty minutes (empty results: five minutes).
  This is best-effort isolate-local protection, not a durable or global quota gate.
- Empty exact records still receive one structured fallback; unrelated results
  are treated as a miss. Requests identify Versal with `Lrclib-Client` (plus a
  User-Agent on the server) and retain fractional track duration.
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

The October 24 review reconfirmed the same reference tree. Its fixed one-second
checks avoid the long recovery gaps that Versal previously imposed after empty
or failed playback responses. Versal now uses bounded prompt recovery checks,
while retaining the normal three-second cadence and provider cooldown gates.
The reference also clears lyrics on an empty sample; Versal's twelve-second
grace is an independent improvement, not behavior attributed to the reference.
Regression tests reproduced the previous mid-song empty-page transition and
minute-long error wait. Production HTTP 200 logs alone cannot prove which
responses had missing track data; the new boolean-only diagnostics help
distinguish that condition without collecting listener metadata.

The October 18 comparison used reference tree
`37c2097347f720a7b0170c7d3d7f7d1c19d035fc`. At that baseline both applications
fetched lyrics on the server; the reference still does. The reference keeps
completed lyric promises, including misses, for
the browser session instead of issuing an unlimited automatic network retry loop.
Versal retains its bounded cache and structured fallback, with bounded recovery
and cancellation of superseded browser requests. A live diagnostic also observed
LRCLIB returning 503 with Retry-After, then succeeding on a later request; such a
response must not be flattened to a generic 502 with its deadline discarded.

### Direct transport investigation (October 18)

Production logs showed genuine upstream 429/503 responses with `Retry-After: 1`,
while Spotify playback calls were healthy. A successful hosted lyric response
took roughly 0.4 seconds; most observed delay came from failures and retries.
A desktop/reference comparison then returned synced lyrics in roughly 0.3/0.7
seconds, and a real in-app-browser CORS probe succeeded in about 0.4 seconds.
These were separate observations, not a simultaneous controlled comparison:
they suggest a hosted-egress/provider-edge interaction but do not establish its
cause or prove browser transport will work on the vehicle's network.

The direct adapter is an independent transport choice, not code copied from the
reference viewer. [LRCLIB's API documentation](https://lrclib.net/docs) describes
browser CORS support, the client-identification header, spacing, and Retry-After.
No API key, second lyric provider, faster Spotify polling, or credential exposure
is introduced. Long-term reliability and Tesla-browser compatibility require
real-device use after rollout.

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
