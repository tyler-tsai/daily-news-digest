/**
 * Full preview: fetch -> cluster -> OpenAI summarize -> print.
 * Skips NewsAPI and Telegram delivery so it runs with only OPENAI_API_KEY.
 *
 * Usage: pnpm exec tsx src/preview-full.ts [ai|world|finance]
 */
require("dotenv").config(); // local .env

// Stub envs the config layer requires but we won't actually use
process.env.TELEGRAM_BOT_TOKEN ||= "stub";
process.env.TG_GROUP_AI ||= "stub";
process.env.TG_GROUP_FINANCE ||= "stub";
process.env.NEWSAPI_KEY ||= "stub";

(async () => {
  const { fetchRSSFeeds, AI_RSS_FEEDS, AI_BUILDER_RSS_FEEDS, FINANCE_RSS_FEEDS } = await import("./services/rss");
  const { clusterBySignal } = await import("./services/cluster");
  const { summarizeNews } = await import("./services/openai");
  const { filterUnsent } = await import("./services/sentStore");

  const category = (process.argv[2] || "ai") as "ai" | "ai-builder" | "world" | "finance";
  const feeds =
    category === "ai" ? AI_RSS_FEEDS :
    category === "ai-builder" ? AI_BUILDER_RSS_FEEDS :
    FINANCE_RSS_FEEDS;

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📰 FULL PREVIEW: ${category.toUpperCase()}`);
  console.log(`   ${feeds.length} RSS feeds → cluster → GPT-4o → digest`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  const t0 = Date.now();
  const items = await fetchRSSFeeds(feeds);
  console.log(`✅ Fetched ${items.length} articles (${Date.now() - t0}ms)`);

  const clustered = clusterBySignal(items);
  const multi = clustered.filter((c) => (c.signalCount ?? 1) >= 2).length;
  console.log(`🔗 ${clustered.length} clusters, ${multi} multi-source`);

  // Same filter the real job applies (read-only — does NOT markSent in preview)
  const fresh = await filterUnsent(clustered);
  if (fresh.length < clustered.length) {
    console.log(`🗂  ${clustered.length - fresh.length} previously-sent items filtered`);
  }

  console.log(`\n🤖 Calling OpenAI...`);
  const t1 = Date.now();
  const digest = await summarizeNews(fresh, category);
  console.log(`✅ Generated ${digest.length} digest items (${Date.now() - t1}ms)\n`);

  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📋 FINAL DIGEST (would be sent to Telegram):`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  digest.forEach((d, i) => {
    console.log(`${i + 1}. 【${d.title}】`);
    if (d.summary) console.log(`   ${d.summary}`);
    console.log(`   📎 ${d.source} — ${d.url}\n`);
  });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
