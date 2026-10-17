import { NextRequest, NextResponse } from "next/server";
import { exchangeSpotifyCode, persistSpotifySession, SPOTIFY_OAUTH_COOKIE } from "../../../lib/spotify";
import { unseal } from "../../../lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const home = new URL("/", request.url);
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const error = request.nextUrl.searchParams.get("error");
  const oauth = await unseal<{ state: string; createdAt: number }>(request.cookies.get(SPOTIFY_OAUTH_COOKIE)?.value);
  if (error || !code || !state || !oauth || oauth.state !== state || Date.now() - oauth.createdAt > 600_000) {
    home.searchParams.set("spotify", "authorization-error");
    return NextResponse.redirect(home);
  }
  try {
    const session = await exchangeSpotifyCode(code);
    home.searchParams.set("spotify", "connected");
    const response = NextResponse.redirect(home);
    await persistSpotifySession(response, session);
    response.cookies.set(SPOTIFY_OAUTH_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
    return response;
  } catch {
    home.searchParams.set("spotify", "token-error");
    return NextResponse.redirect(home);
  }
}
