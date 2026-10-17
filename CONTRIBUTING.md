# Contributing to Versal

Keep changes focused and explain the user-visible problem, the resulting behavior,
and the validation performed. Run `npm run typecheck:client` and `npm test` before
submitting a pull request.

Playback, lyric loading, saved preferences, and display components have separate
owners. Keep fetching and timers in the hooks or services rather than in display
components. Preserve these behaviors:

- Respect every provider cooldown; refresh must not bypass Retry-After.
- Keep one playback poller per mounted app, with lifecycle cleanup.
- Preserve tab leadership and hidden/offline request checks.
- Reject stale lyric responses using track identity and generation.
- Keep plain lyrics untimed and avoid inventing line activation timestamps.
- Preserve the centered active line and surrounding context when refactoring.

Use invented song text and mocked requests in tests. Changes to synchronization
or layout also need a manual check with real playback on the intended display;
automated tests alone do not establish audible alignment.

Do not commit credentials, cookies, session data, provider response captures, or
copied song lyrics. Report a potential credential exposure privately using
GitHub's security advisory feature when enabled, rather than posting the value
in a public issue.
