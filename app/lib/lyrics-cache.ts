import { selectLyricsRecord } from "./lyrics";

const KEY = "versal-lyrics-cache-v1";
const TTL = 7 * 24 * 60 * 60_000;
const MAX_CHARACTERS = 500_000;
type Saved = { key: string; expires: number; records: unknown[] };
type StorageAccess = Pick<Storage, "getItem" | "setItem">;

/** Successful lyrics only; optional storage failures must never break playback. */
export class SavedLyricsCache {
  constructor(private storage: () => StorageAccess, private now = Date.now) {}

  private read(): Saved[] {
    try {
      const raw = this.storage().getItem(KEY);
      if (!raw || raw.length > MAX_CHARACTERS) return [];
      const rows: unknown = JSON.parse(raw);
      if (!Array.isArray(rows)) return [];
      return rows.filter((row): row is Saved => {
        if (!row || typeof row.key !== "string" || !Number.isFinite(row.expires)
          || row.expires <= this.now() || row.expires > this.now() + TTL
          || !Array.isArray(row.records) || row.records.length !== 1) return false;
        const params = new URL(row.key, "https://versal.invalid").searchParams;
        return Boolean(selectLyricsRecord(row.records, params.get("track") || "",
          [params.get("artist") || ""], params.get("album") || "", Number(params.get("duration"))));
      }).slice(-50);
    } catch { return []; }
  }

  get(key: string) { return this.read().find((row) => row.key === key)?.records; }

  put(key: string, records: unknown[]) {
    if (!records.length) return;
    try {
      const entry = { key, records, expires: this.now() + TTL };
      if (JSON.stringify([entry]).length > MAX_CHARACTERS) return;
      const rows = this.read().filter((row) => row.key !== key);
      rows.push(entry);
      while (rows.length > 50 || JSON.stringify(rows).length > MAX_CHARACTERS) rows.shift();
      this.storage().setItem(KEY, JSON.stringify(rows));
    } catch { /* Private browsing, blocked storage, or quota: retain memory cache. */ }
  }
}
