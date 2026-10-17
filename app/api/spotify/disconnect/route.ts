import { NextResponse } from "next/server";
import { clearSpotifyCookies } from "../../../lib/spotify";

export async function POST() {
  const response = NextResponse.json({ connected: false });
  clearSpotifyCookies(response);
  return response;
}
