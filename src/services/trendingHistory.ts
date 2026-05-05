import { promises as fs } from "fs";
import path from "path";
import { TrendingRepo } from "./githubTrending";

/**
 * Track which repos have appeared on github.com/trending/daily and for how
 * many consecutive days. Drives the "🔥 連 N 日" streak badge so repeats in
 * the daily section are clearly marked as continued momentum, not noise.
 *
 * Replaces the previous sentStore-based dedup for AI Trending — that approach
 * was hostile to the streak signal because it actively hid persisting repos.
 */

const STATE_DIR = path.join(process.cwd(), ".state");
const HISTORY_FILE = path.join(STATE_DIR, "trending-history.json");

// Drop entries unseen for 30 days — keeps file small while preserving enough
// context to detect a returning repo as a fresh streak rather than a continuation.
const PRUNE_AFTER_DAYS = 30;

interface RepoHistory {
  firstSeenInDaily: string; // YYYY-MM-DD
  lastSeenInDaily: string;
  consecutiveDays: number;
}

interface History {
  repos: Record<string, RepoHistory>;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateOffset(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function loadHistory(): Promise<History> {
  try {
    const raw = await fs.readFile(HISTORY_FILE, "utf-8");
    return JSON.parse(raw) as History;
  } catch {
    return { repos: {} };
  }
}

async function saveHistory(h: History): Promise<void> {
  await fs.mkdir(STATE_DIR, { recursive: true });
  await fs.writeFile(HISTORY_FILE, JSON.stringify(h, null, 2));
}

function pruneStale(h: History): History {
  const cutoff = dateOffset(todayStr(), -PRUNE_AFTER_DAYS);
  const repos: Record<string, RepoHistory> = {};
  for (const [k, v] of Object.entries(h.repos)) {
    if (v.lastSeenInDaily >= cutoff) repos[k] = v;
  }
  return { repos };
}

/**
 * Record today's daily trending repos and return streak count per repo.
 * Streak resets if a repo wasn't on yesterday's list (gap = restart).
 *
 * @returns Map<fullName, consecutiveDays>; first-seen repos = 1
 */
export async function recordDailyTrending(
  repos: TrendingRepo[]
): Promise<Map<string, number>> {
  const today = todayStr();
  const yesterday = dateOffset(today, -1);
  const history = pruneStale(await loadHistory());
  const streaks = new Map<string, number>();

  for (const repo of repos) {
    const existing = history.repos[repo.fullName];
    if (!existing) {
      history.repos[repo.fullName] = {
        firstSeenInDaily: today,
        lastSeenInDaily: today,
        consecutiveDays: 1,
      };
    } else if (existing.lastSeenInDaily === today) {
      // Same-day repeat run — leave streak unchanged
    } else if (existing.lastSeenInDaily === yesterday) {
      existing.consecutiveDays += 1;
      existing.lastSeenInDaily = today;
    } else {
      // Gap detected — start a fresh streak
      existing.firstSeenInDaily = today;
      existing.lastSeenInDaily = today;
      existing.consecutiveDays = 1;
    }
    streaks.set(repo.fullName, history.repos[repo.fullName].consecutiveDays);
  }

  await saveHistory(history);
  return streaks;
}
