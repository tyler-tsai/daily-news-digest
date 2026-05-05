import { fetchRSSFeeds, AI_RSS_FEEDS } from "../services/rss";
import { fetchAINews } from "../services/newsapi";
import { summarizeNews } from "../services/openai";
import { sendAIDigest } from "../services/telegram";
import { clusterBySignal } from "../services/cluster";
import { filterUnsent, markSent } from "../services/sentStore";
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

    // Cluster near-duplicate stories across sources, then rank by signal score
    // (multi-source repetition × source-tier weight). This replaces the prior
    // exact-prefix dedup which missed "GPT-5 launches" vs "OpenAI ships GPT-5".
    const clustered = clusterBySignal(allItems);
    const multiSource = clustered.filter((i) => (i.signalCount ?? 1) >= 2).length;
    console.log(
      `[AI News] ${clustered.length} clusters (${multiSource} confirmed by 2+ sources)`
    );

    const fresh = await filterUnsent(clustered);
    if (fresh.length < clustered.length) {
      console.log(`[AI News] Filtered ${clustered.length - fresh.length} previously-sent items`);
    }

    const digest = await summarizeNews(fresh, "ai");
    console.log(`[AI News] Generated ${digest.length} digest items`);

    await sendAIDigest(digest);
    await markSent(digest.map((d) => d.url));
    console.log("[AI News] Job completed successfully");
  } catch (err) {
    console.error(`[AI News] Job failed: ${err}`);
  }
}
