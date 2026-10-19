"use client";

import { useRef, useState, type RefObject } from "react";
import { parseLyrics, normalizeTrackTitle, selectLyricsRecord, type LyricLine } from "../lib/lyrics";
import { LyricsRequests, LyricsRequestError } from "../lib/lyrics-request";
import type { LyricsStatus } from "../lib/client-types";
import { LYRICS_COOLDOWN_KEY, LYRICS_RETRY_DELAY_MS, LYRICS_MAX_AUTOMATIC_RETRIES, LYRICS_MAX_PROVIDER_RETRIES } from "../lib/client-config";

/** Owns lookup/cache/retry state. Track identity plus a generation prevents stale results. */
export function useLyricsLoader(spotifyTrackRef: RefObject<string>) {
  const [track, setTrack] = useState({ title: "", artist: "", album: "", source: "", duration: 0 });
  const [lines, setLines] = useState<LyricLine[]>([]);
  const [lyricsStatus, setLyricsStatus] = useState<LyricsStatus>("idle");
  const [lyricsRetryAt, setLyricsRetryAt] = useState(0);
  const lyricsRequestsRef = useRef<LyricsRequests | null>(null);
  const lyricsGenerationRef = useRef(0);
  const lyricsStatusRef = useRef<LyricsStatus>("idle");
  const lyricsRetryTimerRef = useRef(0);
  const lyricsRequestRef = useRef<AbortController | null>(null);

  function updateLyricsStatus(status: LyricsStatus) {
    lyricsStatusRef.current = status;
    setLyricsStatus(status);
    setLyricsRetryAt(0);
  }

  function cancelLyrics() {
    lyricsGenerationRef.current += 1;
    lyricsRequestRef.current?.abort();
    lyricsRequestRef.current = null;
    window.clearTimeout(lyricsRetryTimerRef.current);
  }

  function clearLyrics() {
    cancelLyrics();
    setTrack({ title: "", artist: "", album: "", source: "", duration: 0 });
    setLines([]);
    updateLyricsStatus("idle");
  }

  async function loadSpotifyLyrics(
    identity: string, title: string, artists: string[], collection: string, duration: number,
    options: { force?: boolean; retryAttempt?: number } = {},
  ) {
    if (spotifyTrackRef.current !== identity) return;
    const generation = ++lyricsGenerationRef.current;
    lyricsRequestRef.current?.abort();
    const controller = new AbortController();
    lyricsRequestRef.current = controller;
    const isCurrent = () => spotifyTrackRef.current === identity && lyricsGenerationRef.current === generation;
    window.clearTimeout(lyricsRetryTimerRef.current);
    setTrack({ title, artist: artists.join(", "), album: collection, source: "Spotify synced", duration: Math.max(1, duration) });
    setLines([]);
    updateLyricsStatus("loading");
    if (!lyricsRequestsRef.current) {
      lyricsRequestsRef.current = new LyricsRequests(fetch, Date.now, () => {
        try {
          const value = Number(window.localStorage.getItem(LYRICS_COOLDOWN_KEY));
          return Number.isFinite(value) ? value : 0;
        } catch { return 0; }
      }, (deadline) => {
        try { window.localStorage.setItem(LYRICS_COOLDOWN_KEY, String(deadline)); } catch { /* Memory fallback is retained. */ }
      });
    }
    try {
      const parameters = new URLSearchParams({
        track: normalizeTrackTitle(title), artist: artists[0] || "Unknown artist",
        album: collection, duration: String(duration),
      });
      const records = await lyricsRequestsRef.current.get(`/api/lyrics/search?${parameters}`, options.force, controller.signal);
      if (!isCurrent()) return;
      const record = selectLyricsRecord(records, title, artists, collection, duration);
      if (!record) throw new LyricsRequestError(404);
      if (record.instrumental) {
        updateLyricsStatus("instrumental");
        return;
      }
      const parsed = parseLyrics(record.syncedLyrics, record.plainLyrics);
      if (!parsed.lines.length) throw new LyricsRequestError(404);
      setTrack({ title, artist: artists.join(", "), album: collection || record.albumName, source: parsed.synced ? "Spotify synced" : "Untimed lyrics", duration: duration || record.duration });
      setLines(parsed.lines);
      updateLyricsStatus(parsed.synced ? "ready" : "plain");
    } catch (error) {
      if (!isCurrent()) return;
      setLines([]);
      const coolingDown = error instanceof LyricsRequestError && error.retryAt > Date.now();
      const retryAttempt = options.retryAttempt ?? 0;
      const canRetry = retryAttempt < (coolingDown ? LYRICS_MAX_PROVIDER_RETRIES : LYRICS_MAX_AUTOMATIC_RETRIES)
        && !(error instanceof LyricsRequestError && [400, 401, 403, 404].includes(error.status));
      updateLyricsStatus(coolingDown && canRetry ? "cooldown" : error instanceof LyricsRequestError && error.status === 404 ? "missing" : "unavailable");
      // One bounded chain per song. Refresh can start another, but cannot bypass
      // a persisted provider deadline. Playback ticks never restart the chain.
      if (canRetry) {
        // A repeated one-second edge response must not produce an endless
        // one-second loop. Longer provider deadlines always take precedence.
        const retryDelay = coolingDown ? Math.min(16_000, 1_000 * 2 ** retryAttempt) : LYRICS_RETRY_DELAY_MS;
        const retryAt = Math.max(Date.now() + retryDelay, coolingDown ? error.retryAt : 0);
        setLyricsRetryAt(retryAt);
        const retry = () => {
          if (!isCurrent()) return;
          if (document.hidden || !navigator.onLine || Date.now() < retryAt) {
            lyricsRetryTimerRef.current = window.setTimeout(retry, Math.min(2_147_483_647, Math.max(1_000, retryAt - Date.now())));
            return;
          }
          void loadSpotifyLyrics(identity, title, artists, collection, duration, { retryAttempt: retryAttempt + 1 });
        };
        lyricsRetryTimerRef.current = window.setTimeout(retry, Math.min(2_147_483_647, Math.max(1_000, retryAt - Date.now())));
      }
    } finally {
      if (lyricsRequestRef.current === controller) lyricsRequestRef.current = null;
    }
  }

  return {
    track,
    lines,
    lyricsStatus,
    lyricsRetryAt,
    lyricsStatusRef,
    loadSpotifyLyrics,
    clearLyrics,
    cancelLyrics,
  };
}

