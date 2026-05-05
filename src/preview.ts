/**
 * Dry-run: fetch real RSS feeds + run clustering, print top results.
 * Skips OpenAI summarization and Telegram delivery so it can run without API keys.
 *
 * Usage: pnpm exec tsx src/preview.ts [ai|finance]
 */
import { fetchRSSFeeds, AI_RSS_FEEDS, AI_BUILDER_RSS_FEEDS, FINANCE_RSS_FEEDS } from "./services/rss";
import { clusterBySignal } from "./services/cluster";

async function main() {
  const category = (process.argv[2] || "ai") as "ai" | "ai-builder" | "finance";
  const feeds =
    category === "ai" ? AI_RSS_FEEDS :
    category === "ai-builder" ? AI_BUILDER_RSS_FEEDS :
    FINANCE_RSS_FEEDS;

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📰 PREVIEW: ${category.toUpperCase()} feeds`);
  console.log(`   ${feeds.length} sources, last 24h, no NewsAPI in this preview`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  const t0 = Date.now();
  const items = await fetchRSSFeeds(feeds);
  console.log(`✅ Fetched ${items.length} articles from ${feeds.length} feeds in ${Date.now() - t0}ms`);

  // Per-source breakdown
  const bySource = new Map<string, number>();
  for (const item of items) {
    bySource.set(item.source, (bySource.get(item.source) || 0) + 1);
  }
  console.log(`\n📊 Per-source counts (after filters + per-source cap):`);
  for (const [source, count] of [...bySource.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${count.toString().padStart(3)} | ${source}`);
  }

  // Cluster
  const clustered = clusterBySignal(items);
  const multiSource = clustered.filter((c) => (c.signalCount ?? 1) >= 2);
  console.log(`\n🔗 Clustered into ${clustered.length} stories`);
  console.log(`   ${multiSource.length} confirmed by 2+ sources (these are the strongest signals)\n`);

  // Show top 15 by signal score
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`🏆 TOP 15 BY SIGNAL SCORE (what gets sent to LLM):`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  clustered.slice(0, 15).forEach((c, i) => {
    const signal = c.signalCount ?? 1;
    const score = (c.signalScore ?? 1).toFixed(2);
    const sources = c.sources && c.sources.length > 1 ? c.sources.join(", ") : c.source;
    const tag = signal >= 2 ? `🔥 ${signal}x [${sources}]` : `   1x [${c.source}]`;
    const time = new Date(c.publishedAt).toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
    console.log(`\n${(i + 1).toString().padStart(2)}. score=${score.padStart(5)}  ${tag}  ${time}`);
    console.log(`    ${c.title}`);
  });

  // Show what would be DROPPED at slice(0, maxItems) cutoff
  const maxItems = category === "ai" ? 30 : 50;
  if (clustered.length > maxItems) {
    console.log(`\n💡 ${clustered.length - maxItems} stories below rank ${maxItems} would NOT reach LLM (low signal).`);
  }
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
