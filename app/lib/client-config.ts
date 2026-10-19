import type { FontStyle, VisibilityMode } from "./client-types";

// Keep these storage keys stable so existing preferences and cooldowns survive updates.
export const DISPLAY_PREFERENCES_KEY = "roadverse-display-preferences-v1";
export const SPOTIFY_CHANNEL_NAME = "roadverse-spotify-polling-v1";
export const SPOTIFY_COOLDOWN_KEY = "roadverse-spotify-cooldown-v1";
export const SPOTIFY_LEADER_KEY = "roadverse-spotify-poll-leader-v1";
export const LYRICS_COOLDOWN_KEY = "versal-lyrics-cooldown-v1";
export const SPOTIFY_LEADER_LEASE_MS = 45_000;
export const SPOTIFY_PLAYING_POLL_MS = 3_000;
export const SPOTIFY_PAUSED_POLL_MS = 3_000;
export const SPOTIFY_TRANSITION_POLL_MS = 1_000;
export const SPOTIFY_TRANSITION_CHECKS = 2;
export const SPOTIFY_IDLE_POLL_MS = 30_000;
export const SPOTIFY_FOLLOWER_POLL_MS = 10_000;
export const SPOTIFY_ERROR_POLL_MS = 60_000;
export const LYRICS_RETRY_DELAY_MS = 12_000;
export const LYRICS_MAX_AUTOMATIC_RETRIES = 1;
export const LYRICS_MAX_PROVIDER_RETRIES = 5;
export const FONT_SCALES = [0.82, 1, 1.18] as const;
export const FOCUS_ZOOMS = [1.08, 1.25, 1.45] as const;
export const VISIBILITY_MODES: Array<{ value: VisibilityMode; label: string }> = [
  { value: "night", label: "Night" },
  { value: "balanced", label: "Balanced" },
  { value: "daylight", label: "Daylight" },
];
export const FONT_STYLES: Array<{ value: FontStyle; label: string }> = [
  { value: "modern", label: "Modern" },
  { value: "editorial", label: "Editorial" },
  { value: "rounded", label: "Rounded" },
  { value: "humanist", label: "Humanist" },
  { value: "mono", label: "Mono" },
];
export const ACCENT_OPTIONS = [
  { color: "#d8ff65", label: "Road lime" },
  { color: "#fff07a", label: "Daylight yellow" },
  { color: "#74dfff", label: "Sky blue" },
  { color: "#ff9f7a", label: "Sunset coral" },
  { color: "#c3a6ff", label: "Night violet" },
  { color: "#f4e8d1", label: "Soft ivory" },
];

