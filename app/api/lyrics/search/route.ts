import { NextRequest } from "next/server";
import { hasSpotifySession } from "../../../lib/spotify";
import { LrclibService } from "../../../lib/lrclib";

export const dynamic = "force-dynamic";
const lyricsService = new LrclibService();

export async function GET(request: NextRequest) {
  if (!(await hasSpotifySession(request))) {
    return Response.json({ error: "Connect Spotify to search lyrics." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const params = request.nextUrl.searchParams;
  const track = params.get("track")?.trim() || "";
  const artist = params.get("artist")?.trim() || "";
  const album = params.get("album")?.trim() || "";
  const query = params.get("q")?.trim() || "";
  if (((!track || !artist) && query.length < 2) || [track, artist, album, query].some((value) => value.length > 500)) {
    return Response.json({ error: "Invalid song details." }, { status: 400 });
  }
  return lyricsService.get({ track, artist, album, duration: Number(params.get("duration") || 0), query });
}
