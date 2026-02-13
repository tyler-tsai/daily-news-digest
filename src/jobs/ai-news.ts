import { fetchRSSFeeds, AI_RSS_FEEDS } from "../services/rss";
import { fetchAINews } from "../services/newsapi";
import { summarizeNews } from "../services/openai";
import { sendAIDigest } from "../services/telegram";
import { NewsItem } from "../types";

export async function runAINewsJob(): Promise<void> {
  console.log(`[AI News] Job started at ${new Date().toISOString()}`);

  try {
    // Fetch from both sources in parallel
    const [rssItems, newsapiItems] = await Promise.allSettled([
      fetchRSSFeeds(AI_RSS_FEEDS),
      fetchAINews(),
    ]);

    const allItems: NewsItem[] = [
      ...(rssItems.status === "fulfilled" ? rssItems.value : []),
      ...(newsapiItems.status === "fulfilled" ? newsapiItems.value : []),
    ];

    console.log(`[AI News] Fetched ${allItems.length} articles total`);

    if (allItems.length === 0) {
      console.warn("[AI News] No articles found");
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

    console.log(`[AI News] ${unique.length} unique articles after dedup`);

    // Summarize with OpenAI
    const digest = await summarizeNews(unique, "ai");
    console.log(`[AI News] Generated ${digest.length} digest items`);

    // Send to Telegram
    await sendAIDigest(digest);
    console.log("[AI News] Job completed successfully");
  } catch (err) {
    console.error(`[AI News] Job failed: ${err}`);
  }
}
