import { NextRequest, NextResponse } from "next/server";
import { randomToken, seal, setEncryptedCookie } from "../../../lib/session";
import { spotifyConfig, SPOTIFY_OAUTH_COOKIE, SPOTIFY_SCOPE } from "../../../lib/spotify";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const config = spotifyConfig();
    const state = randomToken(32);
    const authorization = new URL("https://accounts.spotify.com/authorize");
    authorization.search = new URLSearchParams({
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: SPOTIFY_SCOPE,
      state,
    }).toString();
    const response = NextResponse.redirect(authorization);
    setEncryptedCookie(response, SPOTIFY_OAUTH_COOKIE, await seal({ state, createdAt: Date.now() }), 600);
    return response;
  } catch {
    const home = new URL("/", request.url);
    home.searchParams.set("spotify", "configuration-error");
    return NextResponse.redirect(home);
  }
}
