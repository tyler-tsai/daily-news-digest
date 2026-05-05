import { fetchAITrending, TrendingRepo } from "../services/githubTrending";
import { sendAITrendingDigest } from "../services/telegram";
import { summarizeRepos } from "../services/openai";
import { recordDailyTrending } from "../services/trendingHistory";

/**
 * AI Trending digest — concrete momentum signal from github.com/trending.
 *
 * Sections:
 *   📈 Daily   — top N from last 24h, with streak badge for repos that have
 *                been on the daily list multiple consecutive days
 *   📊 Weekly  — top N from past 7d, excluding repos already in daily section
 *   🌟 Monthly — top N from past 30d, excluding daily/weekly
 *
 * Daily-section repeats are kept (no cross-day dedup) because the streak badge
 * itself is the signal — "this has been hot for 3 days running" matters more
 * than "you saw this yesterday too." Weekly/monthly windows are inherently
 * cumulative and don't need their own dedup either.
 */
const DAILY_TOP_N = 7;
const WEEKLY_TOP_N = 5;
const MONTHLY_TOP_N = 3;

export async function runAIBuilderJob(): Promise<void> {
  console.log(`[AI Trending] Job started at ${new Date().toISOString()}`);

  try {
    const { daily, weekly, monthly } = await fetchAITrending();
    console.log(
      `[AI Trending] Fetched AI repos: ${daily.length} daily / ${weekly.length} weekly / ${monthly.length} monthly`
    );

    if (daily.length === 0 && weekly.length === 0 && monthly.length === 0) {
      console.warn("[AI Trending] No AI trending repos found");
    }

    // Update history + get streak counts. Done before slicing so streaks are
    // recorded for everything that appeared on trending today, not just the
    // top-N we'll display.
    const dailyStreaks = await recordDailyTrending(daily);

    // Cross-section dedup: pin a repo to its narrowest window
    const dailyTop = daily.slice(0, DAILY_TOP_N);
    const dailyUrls = new Set(dailyTop.map((r) => r.url));

    const weeklyTop = weekly
      .filter((r) => !dailyUrls.has(r.url))
      .slice(0, WEEKLY_TOP_N);
    const weeklyUrls = new Set(weeklyTop.map((r) => r.url));

    const monthlyTop = monthly
      .filter((r) => !dailyUrls.has(r.url) && !weeklyUrls.has(r.url))
      .slice(0, MONTHLY_TOP_N);

    const streakSummary = dailyTop
      .map((r) => dailyStreaks.get(r.fullName) ?? 1)
      .filter((s) => s >= 2);
    console.log(
      `[AI Trending] Showing ${dailyTop.length}d + ${weeklyTop.length}w + ${monthlyTop.length}m repos` +
        (streakSummary.length > 0 ? ` (${streakSummary.length} on a streak)` : "")
    );

    // Single batched LLM call generates Chinese hooks + topic tags for all repos.
    // Failure here is non-fatal — digest still sends with English-only cards.
    const summaries = await summarizeRepos([...dailyTop, ...weeklyTop, ...monthlyTop]);
    console.log(`[AI Trending] Generated ${summaries.size} Chinese summaries`);

    await sendAITrendingDigest({
      daily: dailyTop,
      weekly: weeklyTop,
      monthly: monthlyTop,
      summaries,
      dailyStreaks,
    });

    console.log("[AI Trending] Job completed successfully");
  } catch (err) {
    console.error(`[AI Trending] Job failed:`, err);
  }
}
