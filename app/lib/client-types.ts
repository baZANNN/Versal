export type LyricsStatus = "idle" | "loading" | "ready" | "plain" | "missing" | "instrumental" | "unavailable" | "cooldown";
export type VisibilityMode = "night" | "balanced" | "daylight";
export type FontStyle = "modern" | "editorial" | "rounded" | "humanist" | "mono";
export type SpotifyAvailability = "checking" | "ready" | "idle" | "rate-limited" | "quota-exceeded" | "unavailable" | "disconnected";
export type SpotifyNowPlaying = {
  connected: boolean;
  playing?: boolean;
  positionMs?: number;
  observedAt?: number;
  item?: {
    id: string;
    type: string;
    title: string;
    artist: string;
    artists: string[];
    collection: string;
    durationMs: number;
  } | null;
  error?: string;
  reason?: string | null;
  retryAfterSeconds?: number;
  retryAfterProvided?: boolean;
};
export type SpotifyChannelMessage = {
  type: "spotify-snapshot";
  sender: string;
  sentAt: number;
  status: number;
  retryAfterSeconds?: number;
  media: SpotifyNowPlaying;
};
export type SpotifyLeaderLease = { tabId: string; expiresAt: number };
export type SpotifyCooldownRecord = {
  availability: "rate-limited" | "quota-exceeded";
  receivedAt: number;
  retryAfterProvided: boolean;
  retryAfterSeconds: number;
  retryAt: number;
};
