import { fetchRSSFeeds, FINANCE_RSS_FEEDS } from "../services/rss";
import { fetchFinanceNews } from "../services/newsapi";
import { summarizeNews } from "../services/openai";
import { sendWorldDigest, sendFinanceDigest } from "../services/telegram";
import { NewsItem } from "../types";

export async function runFinanceNewsJob(): Promise<void> {
  console.log(`[Finance News] Job started at ${new Date().toISOString()}`);

  try {
    // Fetch from both sources in parallel
    const [rssItems, newsapiItems] = await Promise.allSettled([
      fetchRSSFeeds(FINANCE_RSS_FEEDS),
      fetchFinanceNews(),
    ]);

    const allItems: NewsItem[] = [
      ...(rssItems.status === "fulfilled" ? rssItems.value : []),
      ...(newsapiItems.status === "fulfilled" ? newsapiItems.value : []),
    ];

    console.log(`[Finance News] Fetched ${allItems.length} articles total`);

    if (allItems.length === 0) {
      console.warn("[Finance News] No articles found");
    }

    // Deduplicate across sources
    const seen = new Set<string>();
    const unique = allItems
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
      .filter((item) => {
        const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 50);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    console.log(`[Finance News] ${unique.length} unique articles after dedup`);

    // Summarize with OpenAI — world news and finance in parallel
    const [worldDigest, financeDigest] = await Promise.all([
      summarizeNews(unique, "world"),
      summarizeNews(unique, "finance"),
    ]);
    console.log(`[Finance News] Generated ${worldDigest.length} world + ${financeDigest.length} finance digest items`);

    // Send to Telegram — world first, then finance
    await sendWorldDigest(worldDigest);
    await new Promise((r) => setTimeout(r, 2000));
    await sendFinanceDigest(financeDigest);
    console.log("[Finance News] Job completed successfully");
  } catch (err) {
    console.error(`[Finance News] Job failed: ${err}`);
  }
}
