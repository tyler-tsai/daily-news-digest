import { fetchRSSFeeds, FINANCE_RSS_FEEDS } from "../services/rss";
import { fetchFinanceNews } from "../services/newsapi";
import { summarizeNews } from "../services/openai";
import { sendWorldDigest, sendFinanceDigest } from "../services/telegram";
import { clusterBySignal } from "../services/cluster";
import { filterUnsent, markSent } from "../services/sentStore";
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

    const clustered = clusterBySignal(allItems);
    const multiSource = clustered.filter((i) => (i.signalCount ?? 1) >= 2).length;
    console.log(
      `[Finance News] ${clustered.length} clusters (${multiSource} confirmed by 2+ sources)`
    );

    const fresh = await filterUnsent(clustered);
    if (fresh.length < clustered.length) {
      console.log(`[Finance News] Filtered ${clustered.length - fresh.length} previously-sent items`);
    }

    // Summarize with OpenAI — world news and finance in parallel
    const [worldDigest, financeDigest] = await Promise.all([
      summarizeNews(fresh, "world"),
      summarizeNews(fresh, "finance"),
    ]);
    console.log(`[Finance News] Generated ${worldDigest.length} world + ${financeDigest.length} finance digest items`);

    // Send to Telegram only
    await sendWorldDigest(worldDigest);
    await new Promise((r) => setTimeout(r, 2000));
    await sendFinanceDigest(financeDigest);
    await markSent([...worldDigest.map((d) => d.url), ...financeDigest.map((d) => d.url)]);
    console.log("[Finance News] Job completed successfully");
  } catch (err) {
    console.error(`[Finance News] Job failed: ${err}`);
  }
}
