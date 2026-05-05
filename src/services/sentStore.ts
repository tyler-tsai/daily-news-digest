import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { NewsItem } from "../types";

/**
 * Cross-day dedup: persist URLs already shipped to Telegram so the next day's
 * digest doesn't re-show the same article. Required because the AI builder
 * digest uses a 72h fetch window — same Simon Willison post would appear in
 * three consecutive digests without this.
 *
 * Storage: .state/sent.json (gitignored). Single JSON file is fine for our
 * volume (~30 items/day × 14 day retention = ~420 entries).
 */

const STATE_DIR = path.join(process.cwd(), ".state");
const STATE_FILE = path.join(STATE_DIR, "sent.json");

// Retention: 14 days is more than enough — covers our longest fetch window
// (72h for builder) plus buffer for slow-publishing sources that get crawled
// after the original date drops out.
const RETENTION_DAYS = 14;

interface SentRecord {
  urlHash: string;
  sentAt: string; // ISO date
}

interface SentStore {
  items: SentRecord[];
}

/** Strip query params + fragments — same article often shared with utm_* tags */
function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

function hashUrl(url: string): string {
  return createHash("sha1").update(canonicalUrl(url)).digest("hex").slice(0, 16);
}

async function loadStore(): Promise<SentStore> {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf-8");
    return JSON.parse(raw) as SentStore;
  } catch {
    return { items: [] };
  }
}

async function saveStore(store: SentStore): Promise<void> {
  await fs.mkdir(STATE_DIR, { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(store, null, 2));
}

function pruneExpired(store: SentStore): SentStore {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return {
    items: store.items.filter((r) => new Date(r.sentAt).getTime() >= cutoff),
  };
}

/** Drop items whose canonical URL was already sent within the retention window. */
export async function filterUnsent(items: NewsItem[]): Promise<NewsItem[]> {
  const store = await loadStore();
  const sentHashes = new Set(store.items.map((r) => r.urlHash));
  return items.filter((item) => !sentHashes.has(hashUrl(item.url)));
}

/** Record URLs as sent. Call AFTER successful Telegram delivery. */
export async function markSent(urls: string[]): Promise<void> {
  if (urls.length === 0) return;
  const store = pruneExpired(await loadStore());
  const now = new Date().toISOString();
  const existing = new Set(store.items.map((r) => r.urlHash));
  for (const url of urls) {
    const h = hashUrl(url);
    if (!existing.has(h)) {
      store.items.push({ urlHash: h, sentAt: now });
      existing.add(h);
    }
  }
  await saveStore(store);
}
