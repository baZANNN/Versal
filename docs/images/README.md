# Versal UI renders

These images use the real `Topbar`, `LyricsPlayer`, and `DisplaySettings`
components with the production stylesheet. They are static documentation renders,
not recordings of live playback or photographs of a Tesla screen.

The song, artist, album, and lyric text are invented demonstration content. No
account details, provider responses, commercial lyrics, or credentials are used.
The render server makes no Spotify or LRCLIB requests and is not included in the
production app. Animations are frozen for repeatable images.

To reproduce locally, from the repository root:

```sh
npm ci
node scripts/preview-showcase.mjs
```

Open one browser tab at `http://127.0.0.1:4322/?scene=lyrics`. Available scenes:
`lyrics`, `daylight`, `night`, `settings`, and `untimed`. The committed JPEG images
use a 1280 × 720 browser viewport. Use the normal browser viewport when capturing
new images and record its dimensions here. Stop the server with Ctrl+C when finished.

The renders illustrate layout and display choices; they do not establish audible
sync accuracy or guarantee readability in every vehicle and lighting condition.

