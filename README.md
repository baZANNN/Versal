# Versal

Versal follows the song playing on your Spotify account and displays its lyrics
with a large, centered active line. Previous and upcoming lines provide context;
fonts, colors, visibility modes, and the active underline are customizable and
saved between visits.

It uses Spotify for playback metadata and LRCLIB for lyrics. It works with music
playing on Spotify devices, including a vehicle's native Spotify integration.
Untimed lyrics are shown as readable text when line timing is unavailable.

Lyrics load directly from LRCLIB's public browser API, with cookies and credentials
omitted. Spotify authentication and playback access remain server-side. The same
cache, matching, and cooldown protections apply; a failed direct request never
silently switches to a proxy to evade a provider wait.

## Run your own copy

Use Node.js 22.13 or newer:

```sh
npm ci
npm run dev
```

The interface and automated tests can run without Spotify credentials. To connect
your music, create your own Spotify developer app and an ignored `.env.local`
using [.env.example](.env.example). Set:

| Variable | Value |
| --- | --- |
| `SPOTIFY_CLIENT_ID` | Your Spotify app's client ID |
| `SPOTIFY_CLIENT_SECRET` | Your Spotify app's client secret |
| `SPOTIFY_REDIRECT_URI` | Your HTTPS origin plus `/api/spotify/callback` |
| `ROADVERSE_SESSION_SECRET` | A long random secret used to encrypt session cookies |

Generate a session secret with
`node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
Keep it stable so existing sessions can be decrypted.

Register the **exact** redirect URI in Spotify's dashboard. Spotify requires HTTPS
except for explicit loopback IP addresses; `localhost` is not an accepted redirect
host. See [Spotify's redirect URI requirements](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri).
Versal uses Secure cookies, so use an HTTPS deployment or HTTPS development setup
for the complete OAuth flow. Never weaken cookie settings for a public deployment.

The scope is `user-read-currently-playing`. Spotify app eligibility, allowed
users, and rate limits are controlled by Spotify; each person hosting a copy
should use their own credentials. This repository does not supply API access.

The older RoadVerse cookie, storage, and environment-variable names preserve
compatibility with existing sessions and saved preferences.

## Deploy to your Cloudflare account

This copy uses the Cloudflare Vite plugin and [wrangler.jsonc](wrangler.jsonc).
Choose a unique Worker name there and sign in to your own account with
`npx wrangler login`. Create a production secret for each variable listed above:

```sh
npx wrangler secret put SPOTIFY_CLIENT_ID
npx wrangler secret put SPOTIFY_CLIENT_SECRET
npx wrangler secret put SPOTIFY_REDIRECT_URI
npx wrangler secret put ROADVERSE_SESSION_SECRET
npm run deploy
```

Use your Worker's actual HTTPS origin for the redirect URI and register the same
value with Spotify. Local `.env.local` files are not deployed as secrets.
The `nodejs_compat` setting and compatibility date enable server access to
configured secrets through `process.env`; see [Cloudflare's documentation](https://developers.cloudflare.com/changelog/post/2025-03-11-process-env-support/).

Review Cloudflare and Spotify account limits for your usage. The repository does
not promise free hosting at every traffic level. Local-only development needs no
Cloudflare account. No Tesla API, database, or Genius account is needed.

## Review the code

Start with [app/page.tsx](app/page.tsx), which composes the interface.

| Area | Entry point |
| --- | --- |
| Playback polling, tab leadership, cooldowns, re-sync | [use-spotify-playback.ts](app/hooks/use-spotify-playback.ts) |
| Lyric lookup, retries, stale-response guards | [use-lyrics-loader.ts](app/hooks/use-lyrics-loader.ts) |
| Direct browser lyric transport, shared provider matching | [lrclib-browser.ts](app/lib/lrclib-browser.ts), [lrclib-lookup.ts](app/lib/lrclib-lookup.ts) |
| Saved display choices | [use-display-preferences.ts](app/hooks/use-display-preferences.ts) |
| Centered active line, context, untimed lyrics | [lyrics-player.tsx](app/components/lyrics-player.tsx) |
| Timing, display choices, stable storage keys | [client-config.ts](app/lib/client-config.ts) |
| Clock, parsing, matching, request caches | [app/lib](app/lib) |
| OAuth and provider proxy routes | [app/api](app/api) |
| Themes and layout | [globals.css](app/globals.css) |

Playback snapshots update a monotonic clock and identify the track. Track changes
start a lyric lookup. Identity and generation checks prevent older responses
from replacing current lyrics, including a rapid A → B → A transition.
Presentational components render this state without scheduling requests.

The playback hook owns lifecycle cleanup for the lyric loader's retry task.
Status and generation refs allow long-lived callbacks to see current values
without restarting the poller on each render. Preserve that relationship when
changing either hook.

[docs/reliability.md](docs/reliability.md) explains polling frequency, caching,
Retry-After handling, and known limits. The remaining `db/` and Drizzle files
are unused starter scaffolding; they are not part of the lyrics request path.

## Validate changes

```sh
npm run typecheck:client
npm test
```

`npm test` builds the Worker and runs 58 tests with synthetic lyrics, mocked
requests, and a fake clock. It covers parsing, matching, cooldowns, stale song
responses, pauses, podcasts, saved settings, cleanup, and the rendered application
shell without consuming Spotify quota. Direct-transport tests also verify
credential isolation, cancellation, cache reuse, and provider cooldown handling.

The client typecheck covers the page, hooks, components, and imported libraries.
It is not a complete Worker/server typecheck. Real audio alignment and vehicle
layout still need testing on the target device. Use one browser tab during live
testing; hidden pages do not poll, but separate devices use separate requests.

The GitHub Actions workflow runs the same build, tests, and client typecheck.
See [CONTRIBUTING.md](CONTRIBUTING.md) for the invariants to preserve.

## Acknowledgments and license

Thank you to Brent Vollebregt for
[spotify-lyrics-viewer](https://github.com/brentvollebregt/spotify-lyrics-viewer),
which informed comparisons of playback polling, lyric lookup, and code
organization. Versal is maintained as a separate implementation with its own
active-line presentation, context zones, and themes. The reference's optional
Genius integration is not included.

Versal's code is available under the [MIT license](LICENSE). Dependencies retain
their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
The source license does not grant rights to song lyrics or Spotify's branding.

