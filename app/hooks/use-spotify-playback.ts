"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PlaybackClock } from "../lib/playback-clock";
import { formatDuration } from "../lib/format-duration";
import type { SpotifyNowPlaying, SpotifyAvailability, SpotifyCooldownRecord, SpotifyChannelMessage, SpotifyLeaderLease } from "../lib/client-types";
import {
  SPOTIFY_CHANNEL_NAME,
  SPOTIFY_LEADER_KEY,
  SPOTIFY_COOLDOWN_KEY,
  SPOTIFY_LEADER_LEASE_MS,
  SPOTIFY_ERROR_POLL_MS,
  SPOTIFY_TRANSITION_CHECKS,
  SPOTIFY_PLAYING_POLL_MS,
  SPOTIFY_PAUSED_POLL_MS,
  SPOTIFY_TRANSITION_POLL_MS,
  SPOTIFY_IDLE_POLL_MS,
  SPOTIFY_FOLLOWER_POLL_MS,
} from "../lib/client-config";
import { useLyricsLoader } from "./use-lyrics-loader";

/** Single owner of polling, tab leadership, cooldowns, and the monotonic playback clock. */
export function useSpotifyPlayback() {
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [spotifyConnected, setSpotifyConnected] = useState(false);
  const [spotifyChecked, setSpotifyChecked] = useState(false);
  const [spotifyNow, setSpotifyNow] = useState<SpotifyNowPlaying["item"]>(null);
  const [spotifyError, setSpotifyError] = useState("");
  const [spotifyAvailability, setSpotifyAvailability] = useState<SpotifyAvailability>("checking");
  const [spotifyCooldown, setSpotifyCooldown] = useState<SpotifyCooldownRecord | null>(null);
  const [spotifyCooldownRemainingSeconds, setSpotifyCooldownRemainingSeconds] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const spotifyPollingRef = useRef(false);
  const spotifyBackoffUntilRef = useRef(0);
  const spotifyPollDelayRef = useRef(1_000);
  const spotifyThrottleCountRef = useRef(0);
  const spotifySessionConnectedRef = useRef(false);
  const spotifyTabIdRef = useRef("");
  const spotifyIsLeaderRef = useRef(false);
  const spotifyChannelRef = useRef<BroadcastChannel | null>(null);
  const spotifyLastSnapshotAtRef = useRef(0);
  const clockRef = useRef(new PlaybackClock());
  const spotifyRequestRef = useRef<AbortController | null>(null);
  const spotifyLastRequestAtRef = useRef(0);
  const spotifyDisconnectedRef = useRef(false);
  const spotifyScheduleRef = useRef<(delay: number) => void>(() => {});
  const spotifyTrackRef = useRef("");
  const spotifyNowRef = useRef<SpotifyNowPlaying["item"]>(null);
  const spotifyPlayingRef = useRef<boolean | null>(null);
  const spotifyTransitionChecksRef = useRef(0);

  const {
    track,
    lines,
    lyricsStatus,
    lyricsRetryAt,
    lyricsStatusRef,
    loadSpotifyLyrics,
    clearLyrics,
    cancelLyrics,
  } = useLyricsLoader(spotifyTrackRef);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setCurrentTime(clockRef.current.read(performance.now()));
    }, 100);
    return () => window.clearInterval(timer);
  }, [playing]);

  useEffect(() => {
    if (!spotifyCooldown) {
      setSpotifyCooldownRemainingSeconds(0);
      return;
    }
    const updateCountdown = () => setSpotifyCooldownRemainingSeconds(Math.max(0, Math.ceil((spotifyCooldown.retryAt - Date.now()) / 1_000)));
    updateCountdown();
    const timer = window.setInterval(updateCountdown, 1_000);
    return () => window.clearInterval(timer);
  }, [spotifyCooldown]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const spotifyResult = params.get("spotify");
    if (spotifyResult === "connected") setSpotifyConnected(true);
    else if (spotifyResult) setSpotifyError("Spotify authorization did not finish. Check the app settings and try again.");
    if (spotifyResult) window.history.replaceState({}, "", window.location.pathname);
    const restoredCooldown = restoreSpotifyCooldown();
    spotifyTabIdRef.current = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    let spotifyTimer = 0;
    let stopped = false;
    const scheduleSpotifyPoll = (delay: number) => {
      window.clearTimeout(spotifyTimer);
      if (!stopped) spotifyTimer = window.setTimeout(keepSpotifyCurrent, delay);
    };
    spotifyScheduleRef.current = scheduleSpotifyPoll;
    const keepSpotifyCurrent = async () => {
      if (document.hidden) {
        releaseSpotifyLeadership();
        scheduleSpotifyPoll(30_000);
        return;
      }
      await pollSpotify();
      scheduleSpotifyPoll(spotifyPollDelayRef.current);
    };
    if ("BroadcastChannel" in window) {
      const channel = new BroadcastChannel(SPOTIFY_CHANNEL_NAME);
      spotifyChannelRef.current = channel;
      channel.onmessage = (event: MessageEvent<SpotifyChannelMessage>) => {
        const message = event.data;
        if (message?.type !== "spotify-snapshot" || message.sender === spotifyTabIdRef.current || message.sentAt <= spotifyLastSnapshotAtRef.current) return;
        spotifyLastSnapshotAtRef.current = message.sentAt;
        applySpotifySnapshot(message.media, message.status, message.retryAfterSeconds);
      };
    }
    const handleVisibilityChange = () => {
      if (document.hidden) {
        releaseSpotifyLeadership();
        pauseClock();
      }
      scheduleSpotifyPoll(document.hidden ? 30_000 : 250);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === SPOTIFY_LEADER_KEY && !document.hidden) scheduleSpotifyPoll(250);
      if (event.key === SPOTIFY_COOLDOWN_KEY) {
        const cooldown = restoreSpotifyCooldown();
        scheduleSpotifyPoll(cooldown ? Math.max(1_000, cooldown.retryAt - Date.now()) : 250);
      }
    };
    const handlePageHide = () => releaseSpotifyLeadership();
    const handleOnline = () => {
      // A network recovery should not bypass a provider's Retry-After deadline.
      if (!readSpotifyCooldown()) spotifyBackoffUntilRef.current = 0;
      scheduleSpotifyPoll(250);
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);
    window.addEventListener("storage", handleStorage);
    window.addEventListener("pagehide", handlePageHide);
    scheduleSpotifyPoll(restoredCooldown ? Math.max(1_000, restoredCooldown.retryAt - Date.now()) : 0);
    return () => {
      stopped = true;
      spotifyRequestRef.current?.abort();
      cancelLyrics();
      spotifyScheduleRef.current = () => {};
      releaseSpotifyLeadership();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("pagehide", handlePageHide);
      spotifyChannelRef.current?.close();
      spotifyChannelRef.current = null;
      window.clearTimeout(spotifyTimer);
    };
  }, []);

  const connectionStatus = useMemo(() => {
    if (spotifyAvailability === "quota-exceeded" || spotifyAvailability === "rate-limited") return "Spotify cooling down";
    if (spotifyAvailability === "unavailable") return "Spotify reconnecting";
    if (spotifyConnected) return "Spotify connected";
    return "Spotify required";
  }, [spotifyAvailability, spotifyConnected]);

  const activeIndex = useMemo(() => {
    return lines.findLastIndex((line) => Number.isFinite(line.time) && line.time <= currentTime);
  }, [currentTime, lines]);

  const previousContext = useMemo(
    () => activeIndex < 0 ? [] : lines.slice(Math.max(0, activeIndex - 3), activeIndex),
    [activeIndex, lines],
  );
  const upcomingContext = useMemo(
    () => lines.slice(Math.max(0, activeIndex + 1), Math.max(0, activeIndex + 4)),
    [activeIndex, lines],
  );

  function pauseClock() {
    setCurrentTime(clockRef.current.pause(performance.now()));
    setPlaying(false);
  }

  function clearTrack() {
    clearLyrics();
    spotifyTrackRef.current = "";
    spotifyPlayingRef.current = null;
    setCurrentTime(clockRef.current.sync(0, 0, false, performance.now(), true));
    setPlaying(false);
  }

  function claimSpotifyLeadership(force = false) {
    if (document.hidden && !force) return false;
    const tabId = spotifyTabIdRef.current;
    if (!tabId) return true;
    try {
      const now = Date.now();
      const stored = window.localStorage.getItem(SPOTIFY_LEADER_KEY);
      const current = stored ? JSON.parse(stored) as SpotifyLeaderLease : null;
      if (!force && current && current.tabId !== tabId && current.expiresAt > now) {
        spotifyIsLeaderRef.current = false;
        return false;
      }
      const lease: SpotifyLeaderLease = { tabId, expiresAt: now + SPOTIFY_LEADER_LEASE_MS };
      window.localStorage.setItem(SPOTIFY_LEADER_KEY, JSON.stringify(lease));
      const confirmed = JSON.parse(window.localStorage.getItem(SPOTIFY_LEADER_KEY) || "null") as SpotifyLeaderLease | null;
      spotifyIsLeaderRef.current = confirmed?.tabId === tabId;
      return spotifyIsLeaderRef.current;
    } catch {
      // If storage is unavailable, keep the current tab functional.
      spotifyIsLeaderRef.current = true;
      return true;
    }
  }

  function releaseSpotifyLeadership() {
    if (!spotifyIsLeaderRef.current || !spotifyTabIdRef.current) return;
    try {
      const stored = window.localStorage.getItem(SPOTIFY_LEADER_KEY);
      const current = stored ? JSON.parse(stored) as SpotifyLeaderLease : null;
      if (current?.tabId === spotifyTabIdRef.current) window.localStorage.removeItem(SPOTIFY_LEADER_KEY);
    } catch {
      // The short lease will expire if storage cannot be accessed during cleanup.
    }
    spotifyIsLeaderRef.current = false;
  }

  function broadcastSpotifySnapshot(media: SpotifyNowPlaying, status: number, retryAfterSeconds?: number) {
    const sentAt = Date.now();
    spotifyLastSnapshotAtRef.current = sentAt;
    spotifyChannelRef.current?.postMessage({
      type: "spotify-snapshot",
      sender: spotifyTabIdRef.current,
      sentAt,
      status,
      retryAfterSeconds,
      media,
    } satisfies SpotifyChannelMessage);
  }

  function readSpotifyCooldown() {
    try {
      const stored = window.localStorage.getItem(SPOTIFY_COOLDOWN_KEY);
      if (!stored) return null;
      const cooldown = JSON.parse(stored) as SpotifyCooldownRecord;
      if (!cooldown || !Number.isFinite(cooldown.retryAt) || !Number.isFinite(cooldown.retryAfterSeconds)) return null;
      return cooldown;
    } catch {
      return null;
    }
  }

  function restoreSpotifyCooldown() {
    const cooldown = readSpotifyCooldown();
    if (!cooldown || cooldown.retryAt <= Date.now()) {
      if (cooldown) clearSpotifyCooldown();
      return null;
    }
    spotifyBackoffUntilRef.current = Math.max(spotifyBackoffUntilRef.current, cooldown.retryAt);
    spotifyPollDelayRef.current = Math.max(1_000, cooldown.retryAt - Date.now());
    spotifySessionConnectedRef.current = true;
    setSpotifyConnected(true);
    setSpotifyChecked(true);
    setSpotifyAvailability(cooldown.availability);
    setSpotifyCooldown(cooldown);
    setSpotifyError(cooldown.availability === "quota-exceeded"
      ? "Spotify's development request limit is currently exhausted. Versal will wait for the full cooldown."
      : "Spotify asked Versal to pause requests. Versal will wait for the full cooldown.");
    pauseClock();
    return cooldown;
  }

  function persistSpotifyCooldown(cooldown: SpotifyCooldownRecord) {
    const existing = readSpotifyCooldown();
    const effective = existing && existing.retryAt > cooldown.retryAt ? existing : cooldown;
    spotifyBackoffUntilRef.current = effective.retryAt;
    spotifyPollDelayRef.current = Math.max(1_000, effective.retryAt - Date.now());
    setSpotifyCooldown(effective);
    try {
      window.localStorage.setItem(SPOTIFY_COOLDOWN_KEY, JSON.stringify(effective));
    } catch {
      // The in-memory deadline still prevents early retries for this tab.
    }
    return effective;
  }

  function clearSpotifyCooldown() {
    spotifyBackoffUntilRef.current = 0;
    setSpotifyCooldown(null);
    try {
      window.localStorage.removeItem(SPOTIFY_COOLDOWN_KEY);
    } catch {
      // The stored value will be ignored once its deadline has passed.
    }
  }

  function applySpotifySnapshot(media: SpotifyNowPlaying, status: number, retryAfterSeconds?: number, forceClockSync = false) {
    setSpotifyChecked(true);
    if (status === 401) {
      spotifyDisconnectedRef.current = true;
      spotifyPollDelayRef.current = SPOTIFY_ERROR_POLL_MS;
      spotifySessionConnectedRef.current = false;
      setSpotifyAvailability("disconnected");
      setSpotifyConnected(false);
      setSpotifyNow(null);
      spotifyNowRef.current = null;
      clearTrack();
      clearSpotifyCooldown();
      return;
    }
    const activeCooldown = readSpotifyCooldown();
    if (status >= 200 && status < 300 && activeCooldown && activeCooldown.retryAt > Date.now()) {
      restoreSpotifyCooldown();
      return;
    }
    spotifySessionConnectedRef.current = Boolean(media.connected);
    setSpotifyConnected(Boolean(media.connected));
    if (status === 429) {
      spotifyThrottleCountRef.current += 1;
      const quotaExceeded = media.error === "quota-exceeded" || media.reason === "QUOTA_EXCEEDED";
      const rawRetryAfter = Number(media.retryAfterSeconds || retryAfterSeconds || (quotaExceeded ? 3_600 : 60));
      const retryAfter = Number.isFinite(rawRetryAfter) && rawRetryAfter > 0
        ? Math.ceil(rawRetryAfter)
        : quotaExceeded ? 3_600 : 60;
      const baseCooldown = quotaExceeded ? Math.max(300_000, retryAfter * 1_000) : Math.max(45_000, retryAfter * 1_000);
      const repeatedThrottleMultiplier = 2 ** Math.min(spotifyThrottleCountRef.current - 1, 2);
      const additionalBackoff = Math.min(quotaExceeded ? 3_600_000 : 300_000, baseCooldown * repeatedThrottleMultiplier);
      const cooldown = Math.max(retryAfter * 1_000, additionalBackoff);
      const availability = quotaExceeded ? "quota-exceeded" : "rate-limited";
      const persistedCooldown = persistSpotifyCooldown({
        availability,
        receivedAt: Date.now(),
        retryAfterProvided: media.retryAfterProvided === true,
        retryAfterSeconds: retryAfter,
        retryAt: Date.now() + cooldown,
      });
      spotifyPollDelayRef.current = Math.max(1_000, persistedCooldown.retryAt - Date.now());
      setSpotifyAvailability(availability);
      setSpotifyError(quotaExceeded
        ? "Spotify's development request limit is currently exhausted. Versal will wait for the full cooldown."
        : "Spotify asked Versal to pause requests. Versal will wait for the full cooldown.");
      pauseClock();
      return;
    }
    if (status < 200 || status >= 300) {
      spotifyBackoffUntilRef.current = Date.now() + SPOTIFY_ERROR_POLL_MS;
      spotifyPollDelayRef.current = SPOTIFY_ERROR_POLL_MS;
      setSpotifyAvailability("unavailable");
      setSpotifyError("Spotify is temporarily unavailable.");
      pauseClock();
      return;
    }
    spotifyThrottleCountRef.current = 0;
    spotifyDisconnectedRef.current = false;
    clearSpotifyCooldown();
    setSpotifyError("");
    const item = media.item || null;
    spotifyNowRef.current = item;
    setSpotifyNow(item);
    if (item?.type === "track" && item.title && item.artist) {
      const duration = Math.max(1, item.durationMs / 1000);
      const remainingMs = Math.max(0, item.durationMs - Number(media.positionMs || 0));
      setSpotifyAvailability("ready");
      const identity = item.id || `${item.title}\u0000${item.artist}`;
      const songChanged = spotifyTrackRef.current !== identity;
      const isPlaying = Boolean(media.playing);
      const playbackStateChanged = spotifyPlayingRef.current !== null && spotifyPlayingRef.current !== isPlaying;
      spotifyPlayingRef.current = isPlaying;
      if (songChanged || playbackStateChanged) spotifyTransitionChecksRef.current = SPOTIFY_TRANSITION_CHECKS;
      const regularPollDelay = isPlaying
        ? Math.max(750, Math.min(SPOTIFY_PLAYING_POLL_MS, remainingMs + 500))
        : SPOTIFY_PAUSED_POLL_MS;
      if (spotifyTransitionChecksRef.current > 0) {
        spotifyPollDelayRef.current = Math.min(regularPollDelay, SPOTIFY_TRANSITION_POLL_MS);
        spotifyTransitionChecksRef.current -= 1;
      } else {
        spotifyPollDelayRef.current = regularPollDelay;
      }
      if (item.durationMs > 0) {
        const responseAge = media.playing && media.observedAt
          ? Math.min(2, Math.max(0, (Date.now() - media.observedAt) / 1_000))
          : 0;
        const reportedTime = Math.min(duration, Math.max(0, (media.positionMs || 0) / 1_000 + responseAge));
        setCurrentTime(clockRef.current.sync(reportedTime, duration, isPlaying && !document.hidden, performance.now(), forceClockSync || songChanged || playbackStateChanged));
        setPlaying(isPlaying && !document.hidden);
      }
      if (songChanged) {
        spotifyTrackRef.current = identity;
        void loadSpotifyLyrics(identity, item.title, item.artists?.length ? item.artists : [item.artist], item.collection, duration);
      }
    } else {
      spotifyPollDelayRef.current = item ? SPOTIFY_PLAYING_POLL_MS : SPOTIFY_IDLE_POLL_MS;
      spotifyPlayingRef.current = false;
      spotifyTransitionChecksRef.current = 0;
      setSpotifyAvailability("idle");
      clearTrack();
    }
  }

  async function pollSpotify(forceClockSync = false) {
    if (spotifyPollingRef.current || spotifyDisconnectedRef.current || document.hidden || !navigator.onLine) return;
    const cooldownRemaining = Math.max(spotifyBackoffUntilRef.current, readSpotifyCooldown()?.retryAt || 0) - Date.now();
    if (cooldownRemaining > 0) {
      spotifyPollDelayRef.current = Math.max(1_000, cooldownRemaining);
      return;
    }
    // Visibility/storage events and repeated refresh clicks share the same request floor.
    const sinceRequest = Date.now() - spotifyLastRequestAtRef.current;
    if (sinceRequest < 1_000) {
      spotifyPollDelayRef.current = Math.max(250, 1_000 - sinceRequest);
      return;
    }
    if (!claimSpotifyLeadership(forceClockSync)) {
      spotifyPollDelayRef.current = SPOTIFY_FOLLOWER_POLL_MS;
      return;
    }
    spotifyPollingRef.current = true;
    spotifyLastRequestAtRef.current = Date.now();
    const controller = new AbortController();
    spotifyRequestRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort("timeout"), 15_000);
    try {
      const response = await fetch("/api/spotify/now-playing", { cache: "no-store", signal: controller.signal });
      const media = (await response.json()) as SpotifyNowPlaying;
      if (controller.signal.aborted) return;
      const retryAfterSeconds = Math.max(1, Number(media.retryAfterSeconds || response.headers.get("Retry-After") || 30));
      applySpotifySnapshot(media, response.status, retryAfterSeconds, forceClockSync);
      broadcastSpotifySnapshot(media, response.status, retryAfterSeconds);
    } catch {
      if (controller.signal.aborted && controller.signal.reason !== "timeout") return;
      spotifyBackoffUntilRef.current = Date.now() + SPOTIFY_ERROR_POLL_MS;
      spotifyPollDelayRef.current = SPOTIFY_ERROR_POLL_MS;
      setSpotifyAvailability("unavailable");
      setSpotifyError("Spotify is temporarily unavailable. Versal will keep trying.");
      pauseClock();
      broadcastSpotifySnapshot({ connected: spotifySessionConnectedRef.current, error: "spotify-api-error" }, 502);
    } finally {
      window.clearTimeout(timeout);
      if (!controller.signal.aborted || controller.signal.reason === "timeout") setSpotifyChecked(true);
      spotifyPollingRef.current = false;
      if (spotifyRequestRef.current === controller) spotifyRequestRef.current = null;
      spotifyScheduleRef.current(spotifyPollDelayRef.current);
    }
  }

  async function disconnectSpotify() {
    const response = await fetch("/api/spotify/disconnect", { method: "POST" });
    if (!response.ok) { setSpotifyError("Could not disconnect. Please try again."); return; }
    spotifyRequestRef.current?.abort();
    spotifyDisconnectedRef.current = true;
    setSpotifyConnected(false);
    setSpotifyChecked(true);
    setSpotifyNow(null);
    spotifyNowRef.current = null;
    setSpotifyError("");
    setSpotifyAvailability("disconnected");
    spotifySessionConnectedRef.current = false;
    clearSpotifyCooldown();
    spotifyThrottleCountRef.current = 0;
    spotifyTransitionChecksRef.current = 0;
    clearTrack();
    broadcastSpotifySnapshot({ connected: false }, 401);
  }

  async function forceLyricsSync() {
    if (syncing || !spotifyConnected) return;
    setSyncing(true);
    const originalIdentity = spotifyTrackRef.current;
    try {
      for (let attempt = 0; spotifyPollingRef.current && attempt < 12; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 100));
      }
      await pollSpotify(true);
      if (spotifyTrackRef.current === originalIdentity && (lyricsStatusRef.current === "missing" || lyricsStatusRef.current === "unavailable") && spotifyBackoffUntilRef.current <= Date.now()) {
        const item = spotifyNowRef.current;
        if (item?.type === "track" && item.title && item.artist) {
          const identity = item.id || `${item.title}\u0000${item.artist}`;
          await loadSpotifyLyrics(
            identity,
            item.title,
            item.artists?.length ? item.artists : [item.artist],
            item.collection,
            Math.max(1, item.durationMs / 1_000),
            { force: true },
          );
        }
      }
    } finally {
      setSyncing(false);
    }
  }

  const spotifyCoolingDown = spotifyAvailability === "rate-limited" || spotifyAvailability === "quota-exceeded";
  const spotifyRecovering = spotifyCoolingDown || spotifyAvailability === "unavailable";
  const spotifyCooldownDetail = spotifyCooldown
    ? `${spotifyCooldown.retryAfterProvided ? "Spotify Retry-After" : "Versal fallback"}: ${spotifyCooldown.retryAfterSeconds.toLocaleString()} seconds (${formatDuration(spotifyCooldown.retryAfterSeconds)}). Next check in ${formatDuration(spotifyCooldownRemainingSeconds)}.`
    : "";
  const recoveryEyebrow = spotifyAvailability === "quota-exceeded" ? "SPOTIFY REQUEST LIMIT" : spotifyAvailability === "rate-limited" ? "SPOTIFY COOLING DOWN" : "SPOTIFY TEMPORARILY UNAVAILABLE";
  const recoveryHeading = spotifyAvailability === "quota-exceeded" ? "Spotify request limit reached" : "Reconnecting to Spotify…";
  const recoveryCopy = spotifyAvailability === "quota-exceeded"
    ? spotifyCooldownDetail || "Versal has slowed its requests and will recover automatically when Spotify makes playback data available again."
    : spotifyAvailability === "rate-limited"
      ? spotifyCooldownDetail || "Versal is honoring Spotify's cooldown and will retry automatically."
      : "Versal will keep your lyrics in place and retry automatically.";
  const lyricsLookupPending = !!track.title && ["loading", "cooldown", "unavailable"].includes(lyricsStatus);
  const lyricsLookupActive = lyricsStatus === "loading" || lyricsRetryAt > 0;
  const lyricsLookupCopy = lyricsLookupActive ? "Finding lyrics…" : "Lyrics temporarily unavailable. Tap ↻ to retry.";
  const lyricsLookupAnnouncement = lyricsLookupActive ? "Finding lyrics" : "Lyrics temporarily unavailable";

  return {
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
    spotifyAvailability,
    spotifyCooldownRemainingSeconds,
    syncing,
    connectionStatus,
    spotifyCoolingDown,
    spotifyRecovering,
    spotifyCooldownDetail,
    recoveryEyebrow,
    recoveryHeading,
    recoveryCopy,
    lyricsLookupPending,
    lyricsLookupCopy,
    lyricsLookupAnnouncement,
    disconnectSpotify,
    forceLyricsSync,
  };
}

export type SpotifyPlayback = ReturnType<typeof useSpotifyPlayback>;

