export type LyricLine = { time: number; text: string };
export type LyricsRecord = {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
};

export function parseLyrics(value: string | null, plain: string | null) {
  const offsetMs = Number(value?.match(/\[offset:\s*([+-]?\d+)\]/i)?.[1] || 0);
  const parsed: LyricLine[] = [];
  for (const raw of (value || "").split(/\r?\n/)) {
    const row = raw.trim();
    const prefix = row.match(/^(?:\[\d+:\d{1,2}(?:[.:]\d+)?\])+/)?.[0];
    if (!prefix) continue;
    const text = row.slice(prefix.length).replace(/<\d+:\d{1,2}(?:\.\d+)?>/g, "").trim() || "♪";
    for (const stamp of prefix.matchAll(/\[(\d+):(\d{1,2})(?:[.:](\d+))?\]/g)) {
      const seconds = Number(stamp[2]);
      if (seconds >= 60) continue;
      const time = Number(stamp[1]) * 60 + seconds + Number(`0.${stamp[3] || 0}`) - offsetMs / 1_000;
      if (Number.isFinite(time)) parsed.push({ time: Math.max(0, time), text });
    }
  }
  parsed.sort((a, b) => a.time - b.time);
  const lines: LyricLine[] = [];
  for (const line of parsed) {
    const last = lines[lines.length - 1];
    if (last?.time === line.time) {
      if (last.text === "♪") last.text = line.text;
      else if (line.text !== "♪" && !last.text.split("\n").includes(line.text)) last.text += `\n${line.text}`;
    } else lines.push({ ...line });
  }
  if (lines.length) return { lines, synced: true };
  return {
    lines: (plain || "").split(/\r?\n/).map((text) => text.trim()).filter(Boolean)
      .map((text) => ({ time: Number.POSITIVE_INFINITY, text })),
    synced: false,
  };
}

export function normalizeTrackTitle(title: string) {
  return title
    .replace(/\s*[([](?:feat\.?|ft\.?|with)\s+.+?[)\]]/gi, "")
    .replace(/\s+-\s+\d{4}\s+-\s+remaster(?:ed)?(?:\s+\d{4})?.*$/i, "")
    .replace(/\s+-\s+(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?.*$/i, "")
    .replace(/\s+-\s+original album version$/i, "")
    .replace(/\s*[([]live[)\]]$/i, "")
    .replace(/\s+-\s+(?:live(?: from .*)?|acoustic|\d{4} mix|from .*)$/i, "")
    .trim();
}

export function normalizeMatchText(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function related(left: string, right: string) {
  return Boolean(left && right) && (left === right
    || (left.length >= 3 && ` ${right} `.includes(` ${left} `))
    || (right.length >= 3 && ` ${left} `.includes(` ${right} `)));
}

export function selectLyricsRecord(records: unknown[], title: string, artists: string[], album: string, duration: number) {
  const requestedTitle = normalizeMatchText(normalizeTrackTitle(title));
  const requestedArtists = artists.map(normalizeMatchText).filter(Boolean);
  const requestedAlbum = normalizeMatchText(album);
  return records.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const record = value as LyricsRecord;
    if (typeof record.trackName !== "string" || typeof record.artistName !== "string") return [];
    if ((record.albumName != null && typeof record.albumName !== "string")
      || (record.syncedLyrics != null && typeof record.syncedLyrics !== "string")
      || (record.plainLyrics != null && typeof record.plainLyrics !== "string")) return [];
    const candidateTitle = normalizeMatchText(normalizeTrackTitle(record.trackName));
    const candidateArtist = normalizeMatchText(record.artistName);
    const artistExact = requestedArtists.includes(candidateArtist);
    if (!related(candidateTitle, requestedTitle) || !requestedArtists.some((artist) => related(candidateArtist, artist))) return [];
    if (record.instrumental !== true && !record.syncedLyrics?.trim() && !record.plainLyrics?.trim()) return [];
    const durationDifference = duration > 0 && record.duration > 0 ? Math.abs(record.duration - duration) : Infinity;
    const score = (candidateTitle === requestedTitle ? 100 : 60) + (artistExact ? 50 : 30)
      + (requestedAlbum && normalizeMatchText(record.albumName || "") === requestedAlbum ? 20 : 0)
      + (durationDifference <= 2 ? 30 : durationDifference <= 6 ? 15 : durationDifference > 20 && Number.isFinite(durationDifference) ? -40 : 0)
      + (record.syncedLyrics ? 12 : record.plainLyrics ? 4 : 0);
    return [{ record, score }];
  }).sort((a, b) => b.score - a.score)[0]?.record;
}
