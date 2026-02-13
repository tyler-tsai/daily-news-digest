import Parser from "rss-parser";
import { NewsItem } from "../types";

const parser = new Parser({ timeout: 15000 });

export const AI_RSS_FEEDS = [
  { url: "https://techcrunch.com/category/artificial-intelligence/feed/", source: "TechCrunch" },
  { url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", source: "The Verge" },
  { url: "https://feeds.arstechnica.com/arstechnica/technology-lab", source: "Ars Technica" },
  { url: "https://www.wired.com/feed/tag/ai/latest/rss", source: "WIRED" },
  { url: "https://venturebeat.com/category/ai/feed/", source: "VentureBeat" },
];

export const FINANCE_RSS_FEEDS = [
  { url: "https://feeds.reuters.com/reuters/businessNews", source: "Reuters" },
  { url: "https://feeds.reuters.com/reuters/worldNews", source: "Reuters World" },
  { url: "https://www.cnbc.com/id/100003114/device/rss/rss.html", source: "CNBC" },
  { url: "https://feeds.marketwatch.com/marketwatch/topstories/", source: "MarketWatch" },
  { url: "https://feeds.bbci.co.uk/news/business/rss.xml", source: "BBC Business" },
  { url: "https://feeds.bbci.co.uk/news/world/rss.xml", source: "BBC World" },
];

export async function fetchRSSFeeds(
  feeds: { url: string; source: string }[]
): Promise<NewsItem[]> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const results: NewsItem[] = [];

  const feedResults = await Promise.allSettled(
    feeds.map(async (feed) => {
      try {
        const parsed = await parser.parseURL(feed.url);
        return (parsed.items || [])
          .filter((item) => {
            const pubDate = item.pubDate ? new Date(item.pubDate) : null;
            return pubDate && pubDate >= cutoff;
          })
          .map((item) => ({
            title: item.title || "Untitled",
            description: (item.contentSnippet || item.content || "").slice(0, 500),
            url: item.link || "",
            source: feed.source,
            publishedAt: new Date(item.pubDate!),
          }));
      } catch (err) {
        console.warn(`[RSS] Failed to fetch ${feed.source}: ${err}`);
        return [];
      }
    })
  );

  for (const result of feedResults) {
    if (result.status === "fulfilled") {
      results.push(...result.value);
    }
  }

  // Deduplicate by title similarity
  const seen = new Set<string>();
  return results
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
    .filter((item) => {
      const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 50);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
