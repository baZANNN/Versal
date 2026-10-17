import { NextRequest, NextResponse } from "next/server";
import { seal, setEncryptedCookie, unseal } from "./session";

export const SPOTIFY_SESSION_COOKIE = "roadverse_spotify";
export const SPOTIFY_OAUTH_COOKIE = "roadverse_spotify_oauth";
export const SPOTIFY_SCOPE = "user-read-currently-playing";

export type SpotifySession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

export class SpotifyRefreshError extends Error {
  constructor(public status: number, public retryAfter: string | null = null) {
    super("Spotify token refresh failed");
  }
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export function spotifyConfig() {
  return {
    clientId: required("SPOTIFY_CLIENT_ID"),
    clientSecret: required("SPOTIFY_CLIENT_SECRET"),
    redirectUri: required("SPOTIFY_REDIRECT_URI"),
  };
}

export async function exchangeSpotifyCode(code: string) {
  const config = spotifyConfig();
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
    }),
  });
  if (!response.ok) throw new Error("Spotify code exchange failed");
  const token = (await response.json()) as TokenResponse;
  if (!token.refresh_token) throw new Error("Spotify refresh token missing");
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + token.expires_in * 1000,
  } satisfies SpotifySession;
}

async function refreshSpotifySession(session: SpotifySession) {
  const config = spotifyConfig();
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    signal: AbortSignal.timeout(5_000),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: session.refreshToken,
    }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    // Only a revoked/invalid refresh token means the listener needs to sign in again.
    throw new SpotifyRefreshError(payload?.error === "invalid_grant" ? 401 : response.status === 429 ? 429 : 502, response.headers.get("Retry-After"));
  }
  const token = (await response.json()) as TokenResponse;
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token || session.refreshToken,
    expiresAt: Date.now() + token.expires_in * 1000,
  } satisfies SpotifySession;
}

export async function validSpotifySession(request: NextRequest) {
  const sealed = request.cookies.get(SPOTIFY_SESSION_COOKIE)?.value;
  let session = await unseal<SpotifySession>(sealed);
  if (!session) return null;
  let changed = false;
  if (session.expiresAt < Date.now() + 120_000) {
    session = await refreshSpotifySession(session);
    changed = true;
  }
  return { session, changed };
}

export async function hasSpotifySession(request: NextRequest) {
  const sealed = request.cookies.get(SPOTIFY_SESSION_COOKIE)?.value;
  return Boolean(await unseal<SpotifySession>(sealed));
}

export async function persistSpotifySession(response: NextResponse, session: SpotifySession) {
  setEncryptedCookie(response, SPOTIFY_SESSION_COOKIE, await seal(session), 60 * 60 * 24 * 180);
}

export function clearSpotifyCookies(response: NextResponse) {
  response.cookies.set(SPOTIFY_SESSION_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  response.cookies.set(SPOTIFY_OAUTH_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
}
