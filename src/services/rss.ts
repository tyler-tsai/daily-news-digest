import Parser from "rss-parser";
import { NewsItem } from "../types";

// Browser-like UA — required for Reddit RSS (403 without it) and reduces
// hnrss.org rate-limit hits seen in practice.
const parser = new Parser({
  timeout: 15000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 daily-news-digest/1.0",
  },
});

// AI biz/news — corporate moves, deals, IPOs, regulation, opinion
export const AI_RSS_FEEDS = [
  // Primary sources (official) — highest signal value
  { url: "https://openai.com/blog/rss.xml", source: "OpenAI" },
  { url: "https://blog.google/technology/ai/rss/", source: "Google AI" },
  { url: "https://deepmind.google/blog/rss.xml", source: "DeepMind" },
  // Tech media (secondary coverage)
  { url: "https://techcrunch.com/category/artificial-intelligence/feed/", source: "TechCrunch" },
  { url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", source: "The Verge" },
  { url: "https://feeds.arstechnica.com/arstechnica/technology-lab", source: "Ars Technica" },
  { url: "https://www.wired.com/feed/tag/ai/latest/rss", source: "WIRED" },
  { url: "https://venturebeat.com/category/ai/feed/", source: "VentureBeat" },
];

// AI builder/engineering — open-weight models, libraries, frameworks, methods,
// real engineer voices. Distinct from AI_RSS_FEEDS which is dominated by biz coverage.
export const AI_BUILDER_RSS_FEEDS = [
  // Top-tier engineer blogs — hands-on, practical, no fluff
  { url: "https://simonwillison.net/atom/everything/", source: "Simon Willison" },
  { url: "https://www.latent.space/feed", source: "Latent Space" },
  { url: "https://www.interconnects.ai/feed", source: "Interconnects" },
  { url: "https://lilianweng.github.io/index.xml", source: "Lilian Weng" },
  { url: "https://eugeneyan.com/rss/", source: "Eugene Yan" },
  // Model/library release sources
  { url: "https://huggingface.co/blog/feed.xml", source: "Hugging Face" },
  { url: "https://replicate.com/blog/rss", source: "Replicate" },
  // Engineer communities (Reddit RSS needs the browser UA we set above).
  // Reddit currently 403s post-API-shutdown — kept here so they auto-recover
  // if Reddit re-enables RSS. Failures are caught per-feed.
  { url: "https://www.reddit.com/r/LocalLLaMA/.rss", source: "r/LocalLLaMA" },
  { url: "https://www.reddit.com/r/MachineLearning/.rss", source: "r/MachineLearning" },
  // Lobsters — dev-focused HN alternative; /t/ai is pre-filtered by community tag
  { url: "https://lobste.rs/t/ai.rss", source: "Lobsters" },
  // What repos engineers are starring right now
  { url: "https://mshibanami.github.io/GitHubTrendingRSS/daily/all.xml", source: "GitHub Trending" },
  // Hacker News with AI-keyword post-filter — moved here from AI_RSS_FEEDS
  // because builder context cares more about HN tech threads than biz moves
  { url: "https://hnrss.org/frontpage?points=150", source: "Hacker News" },
];

export const FINANCE_RSS_FEEDS = [
  // Replaced dead Reuters feeds (retired ~2020) with Bloomberg/FT/Economist
  { url: "https://feeds.bloomberg.com/markets/news.rss", source: "Bloomberg" },
  { url: "https://www.ft.com/?format=rss", source: "FT" },
  { url: "https://www.economist.com/finance-and-economics/rss.xml", source: "The Economist" },
  { url: "https://www.cnbc.com/id/100003114/device/rss/rss.html", source: "CNBC" },
  { url: "https://feeds.marketwatch.com/marketwatch/topstories/", source: "MarketWatch" },
  { url: "https://feeds.bbci.co.uk/news/business/rss.xml", source: "BBC Business" },
  { url: "https://feeds.bbci.co.uk/news/world/rss.xml", source: "BBC World" },
];

// Per-source cap — stops one chatty feed from drowning out diverse sources
const MAX_ITEMS_PER_SOURCE = 12;

// Strip publication suffix (" - The Verge", " | TechCrunch") that some feeds append
function cleanTitle(title: string, source: string): string {
  return title
    .replace(new RegExp(`\\s*[-|–]\\s*${source}\\s*$`, "i"), "")
    .replace(/\s+/g, " ")
    .trim();
}

// HN frontpage is general tech (Bun, Redis, Monero, etc.). For our AI digest
// we want only AI-relevant items. This regex stays here — if HN is later added
// to FINANCE_RSS_FEEDS, generalize via a per-feed filter config.
const HN_AI_KEYWORDS =
  /\b(ai|llm|gpt|claude|gemini|llama|openai|anthropic|deepmind|hugging\s*face|chatgpt|copilot|cursor|model|neural|transformer|inference|embedding|rag|fine[-\s]?tun|agent|prompt|reasoning|reinforcement|diffusion|robot|machine[-\s]?learning|deep[-\s]?learning)\b/i;

// Skip low-value items at fetch time
function isLowQuality(title: string, description: string, source: string): boolean {
  // Title must be substantive — many feeds emit empty/placeholder items
  if (title.length < 10) return true;

  // Hacker News pure questions ("Ask HN: ...") aren't news
  if (source === "Hacker News" && /^Ask HN[:：]/i.test(title)) return true;

  // Hacker News frontpage is general tech — for AI digest, drop non-AI items.
  // (Description may be empty for short HN posts — match on title alone too.)
  if (source === "Hacker News" && !HN_AI_KEYWORDS.test(title + " " + description)) {
    return true;
  }

  // Listicle/clickbait patterns
  if (/^(top|the best|\d+\s+(ways|tips|reasons|things|tools))\b/i.test(title)) return true;

  // Sponsored content
  if (/\b(sponsored|advertorial|promoted|partner content)\b/i.test(title + " " + description)) {
    return true;
  }

  return false;
}

export async function fetchRSSFeeds(
  feeds: { url: string; source: string }[],
  // Most news refreshes daily; engineer/builder blogs publish weekly. Override
  // to widen the window for slower-publishing sources.
  lookbackHours: number = 24
): Promise<NewsItem[]> {
  const cutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
  const results: NewsItem[] = [];

  const feedResults = await Promise.allSettled(
    feeds.map(async (feed) => {
      try {
        const parsed = await parser.parseURL(feed.url);
        const items: NewsItem[] = [];
        for (const item of parsed.items || []) {
          const pubDate = item.pubDate ? new Date(item.pubDate) : null;
          if (!pubDate || pubDate < cutoff) continue;

          const rawTitle = item.title || "";
          const description = (item.contentSnippet || item.content || "").slice(0, 500);
          const title = cleanTitle(rawTitle, feed.source);

          if (!title || isLowQuality(title, description, feed.source)) continue;

          items.push({
            title,
            description,
            url: item.link || "",
            source: feed.source,
            publishedAt: pubDate,
          });
        }
        // Cap per-source so a chatty feed can't dominate
        return items
          .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
          .slice(0, MAX_ITEMS_PER_SOURCE);
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

  // Sort latest-first; cluster-level dedup happens downstream in cluster.ts
  return results.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
}
