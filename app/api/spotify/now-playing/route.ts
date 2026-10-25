import { NextRequest, NextResponse } from "next/server";
import { persistSpotifySession, validSpotifySession, SpotifyRefreshError } from "../../../lib/spotify";
import { retryDeadline } from "../../../lib/lyrics-request";

export const dynamic = "force-dynamic";

type SpotifyItem = {
  id?: string;
  type?: string;
  name?: string;
  duration_ms?: number;
  artists?: Array<{ name?: string }>;
  album?: { name?: string };
  show?: { name?: string; publisher?: string };
};

type SpotifyErrorPayload = {
  error?: {
    reason?: string;
  };
};

function clearLegacyVehicleCookies(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store");
  for (const name of ["roadverse_tesla", "roadverse_tesla_oauth"]) {
    response.cookies.set(name, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  }
  return response;
}

export async function GET(request: NextRequest) {
  let valid;
  try {
    valid = await validSpotifySession(request);
  } catch (error) {
    const status = error instanceof SpotifyRefreshError ? error.status : 502;
    if (status === 429) {
      const header = (error as SpotifyRefreshError).retryAfter;
      const retryAfterSeconds = Math.ceil((retryDeadline(header, Date.now(), 60) - Date.now()) / 1_000);
      return clearLegacyVehicleCookies(NextResponse.json({ connected: true, error: "rate-limited", retryAfterSeconds, retryAfterProvided: Boolean(header) }, { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }));
    }
    return clearLegacyVehicleCookies(NextResponse.json({ connected: status !== 401, error: status === 401 ? "session-expired" : "spotify-api-error" }, { status }));
  }
  if (!valid) return clearLegacyVehicleCookies(NextResponse.json({ connected: false }, { status: 401 }));

  try {
    const spotifyResponse = await fetch("https://api.spotify.com/v1/me/player/currently-playing?additional_types=track,episode", {
      headers: { Authorization: `Bearer ${valid.session.accessToken}` },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (spotifyResponse.status === 204) {
      console.info(JSON.stringify({ event: "spotify_playback_empty", upstreamStatus: 204, itemPresent: false }));
      const response = NextResponse.json({ connected: true, playing: false, item: null });
      if (valid.changed) await persistSpotifySession(response, valid.session);
      return clearLegacyVehicleCookies(response);
    }
    if (spotifyResponse.status === 429) {
      const payload = await spotifyResponse.json().catch(() => null) as SpotifyErrorPayload | null;
      const reason = payload?.error?.reason || null;
      const retryAfterHeader = spotifyResponse.headers.get("Retry-After");
      const parsedRetryAfter = Number(retryAfterHeader);
      const retryAfterProvided = retryAfterHeader !== null && Number.isFinite(parsedRetryAfter) && parsedRetryAfter > 0;
      const retryAfterSeconds = retryAfterProvided
        ? Math.ceil(parsedRetryAfter)
        : reason === "QUOTA_EXCEEDED" ? 3_600 : 60;
      const error = reason === "QUOTA_EXCEEDED" ? "quota-exceeded" : "rate-limited";
      console.info("Spotify requested a playback API cooldown", { reason, retryAfterSeconds, retryAfterProvided });
      const response = NextResponse.json(
        { connected: true, error, reason, retryAfterSeconds, retryAfterProvided },
        { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
      );
      if (valid.changed) await persistSpotifySession(response, valid.session);
      return clearLegacyVehicleCookies(response);
    }
    if (!spotifyResponse.ok) throw new Error("spotify-api-error");
    const payload = (await spotifyResponse.json()) as { is_playing?: boolean; progress_ms?: number | null; item?: SpotifyItem | null };
    const item = payload.item;
    const artists = item?.type === "episode"
      ? [item.show?.publisher || item.show?.name || "Podcast"]
      : (item?.artists || []).map((entry) => entry.name).filter((name): name is string => Boolean(name));
    const completeTrack = Boolean(item?.name && artists.length && Number.isFinite(item.duration_ms) && Number(item.duration_ms) > 0);
    if (!item || (item.type !== "episode" && !completeTrack)) {
      // Diagnose missing playback without logging songs, account data, or tokens.
      console.info(JSON.stringify({ event: "spotify_playback_empty", upstreamStatus: spotifyResponse.status,
        itemPresent: Boolean(item), itemType: item?.type || null, playing: Boolean(payload.is_playing),
        hasTitle: Boolean(item?.name), hasArtist: artists.length > 0,
        hasDuration: Number.isFinite(item?.duration_ms) && Number(item?.duration_ms) > 0 }));
    }
    const response = NextResponse.json({
      connected: true,
      playing: Boolean(payload.is_playing),
      positionMs: Number(payload.progress_ms || 0),
      observedAt: Date.now(),
      item: item && (item.type === "episode" || completeTrack) ? {
        id: item.id || `${item.name || "unknown"}:${artists.join(",")}`,
        type: item.type || "track",
        title: item.name || "Unknown title",
        artist: artists.join(", "),
        artists,
        collection: item.type === "episode" ? item.show?.name || "" : item.album?.name || "",
        durationMs: Number(item.duration_ms || 0),
      } : null,
    });
    if (valid.changed) await persistSpotifySession(response, valid.session);
    return clearLegacyVehicleCookies(response);
  } catch {
    const response = NextResponse.json({ connected: true, error: "spotify-api-error" }, { status: 502 });
    if (valid.changed) await persistSpotifySession(response, valid.session);
    return clearLegacyVehicleCookies(response);
  }
}
