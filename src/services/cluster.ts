import { NewsItem } from "../types";

// Source quality tiers — primary sources outweigh secondary coverage.
// Used as a multiplier on signalCount to compute final ranking score.
const SOURCE_TIER: Record<string, number> = {
  // Tier 1 — official primary sources (model labs, foundational orgs)
  OpenAI: 2.0,
  "Google AI": 2.0,
  DeepMind: 2.0,
  "Hugging Face": 1.7, // straddles model-lab + builder — single tier
  // Tier 2 — high-signal community / quality finance
  "Hacker News": 1.5,
  Bloomberg: 1.4,
  FT: 1.4,
  "The Economist": 1.4,
  // AI builder sources — engineer-focused tier
  "Simon Willison": 1.8, // canonical AI engineer blog
  "Latent Space": 1.6,
  Interconnects: 1.6,
  "Lilian Weng": 1.6, // rare but technical depth
  "Eugene Yan": 1.4,
  Replicate: 1.2, // vendor blog, but practical
  "r/LocalLLaMA": 1.5, // very high signal-to-noise for open models
  "r/MachineLearning": 1.4,
  Lobsters: 1.5, // dev community, /t/ai tag
  "GitHub Trending": 1.4, // signal: what repos engineers are starring
  // Tier 3 — solid tech media (default = 1.0)
  TechCrunch: 1.1,
  "The Verge": 1.0,
  "Ars Technica": 1.1,
  WIRED: 1.0,
  CNBC: 1.0,
  MarketWatch: 1.0,
  "BBC Business": 1.0,
  "BBC World": 1.0,
  // Tier 4 — noisier secondary
  VentureBeat: 0.8,
};

const STOPWORDS = new Set([
  // Common English stopwords
  "the", "and", "for", "with", "from", "about", "into", "over", "this", "that",
  "what", "when", "where", "which", "have", "has", "are", "was", "were", "been",
  "will", "would", "could", "should", "more", "than", "after", "before", "they",
  "their", "them", "your", "you", "its", "a", "an", "as", "at", "by", "in",
  "is", "it", "of", "on", "or", "to", "be", "but", "say", "says", "said", "new",
  // News action verbs — synonyms across feeds, low signal for clustering
  "launches", "launched", "launch", "releases", "released", "release",
  "announces", "announced", "announce", "ships", "shipped", "ship",
  "unveils", "unveiled", "unveil", "sets", "set", "today", "now",
  "report", "reports", "reported", "amid", "via", "just", "also",
]);

// Crude plural-stripping so "rates"/"rate" and "stocks"/"stock" cluster.
// Only applied to tokens > 4 chars to avoid mangling short words.
function stem(t: string): string {
  if (t.length > 4 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

function tokenize(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
      .map(stem)
  );
}

// Minimum shared tokens required to consider two titles related — guards
// against false-positive merges where titles only share one common entity word
// (e.g. "OpenAI partners with X" vs "OpenAI sued by Y" both share "openai").
const MIN_SHARED_TOKENS = 2;

function isSimilar(a: Set<string>, b: Set<string>, threshold: number): boolean {
  if (a.size === 0 || b.size === 0) return false;
  let intersect = 0;
  for (const t of a) if (b.has(t)) intersect++;
  if (intersect < MIN_SHARED_TOKENS) return false;
  const union = a.size + b.size - intersect;
  return union > 0 && intersect / union >= threshold;
}

interface Cluster {
  items: NewsItem[];
  tokens: Set<string>;
}

/**
 * Group near-duplicate stories from different sources into clusters and emit
 * one canonical NewsItem per cluster, annotated with signal metadata.
 *
 * Why: A story covered by 3 independent sources is a stronger signal than a
 * lone-source scoop. The user's information-flow strategy explicitly calls for
 * "重複出現的訊號" — we encode that as ranking input for the LLM step.
 *
/**
 * Exponential time decay applied to signalScore — fresher news ranks above
 * older items at the same source-tier and signal-count. Half-life of 24h means:
 *   - 0h:  1.00× (full weight)
 *   - 12h: 0.71×
 *   - 24h: 0.50×
 *   - 48h: 0.25×
 *   - 72h: 0.13×
 * For 24h-cutoff feeds (AI biz / finance) this gently boosts breaking news.
 * For 72h-cutoff feeds (AI builder) this heavily prefers today's posts but
 * still surfaces a strong-signal 2-day-old post over a weak-signal new one.
 */
const RECENCY_HALF_LIFE_HOURS = 24;

function recencyMultiplier(publishedAt: Date): number {
  const hoursAgo = Math.max(0, (Date.now() - publishedAt.getTime()) / 3600000);
  return Math.pow(0.5, hoursAgo / RECENCY_HALF_LIFE_HOURS);
}

/**
 * @param threshold Jaccard similarity for merging (0.3 = standard for news)
 */
export function clusterBySignal(items: NewsItem[], threshold = 0.3): NewsItem[] {
  const clusters: Cluster[] = [];

  for (const item of items) {
    const tokens = tokenize(item.title);
    if (tokens.size === 0) continue;

    let merged = false;
    for (const c of clusters) {
      if (isSimilar(tokens, c.tokens, threshold)) {
        c.items.push(item);
        // Union the tokens — lets a cluster grow as it accumulates phrasings
        for (const t of tokens) c.tokens.add(t);
        merged = true;
        break;
      }
    }
    if (!merged) {
      clusters.push({ items: [item], tokens });
    }
  }

  return clusters
    .map((c) => {
      const sources = [...new Set(c.items.map((i) => i.source))];
      const signalCount = sources.length;
      const tierAvg =
        sources.reduce((sum, s) => sum + (SOURCE_TIER[s] ?? 1.0), 0) / sources.length;

      // Pick the highest-tier source as canonical (prefers OpenAI blog over
      // TechCrunch coverage of same story); break ties by recency.
      const canonical = c.items
        .slice()
        .sort((a, b) => {
          const ta = SOURCE_TIER[a.source] ?? 1.0;
          const tb = SOURCE_TIER[b.source] ?? 1.0;
          if (tb !== ta) return tb - ta;
          return b.publishedAt.getTime() - a.publishedAt.getTime();
        })[0];

      return {
        ...canonical,
        signalCount,
        sources,
        signalScore: signalCount * tierAvg * recencyMultiplier(canonical.publishedAt),
      };
    })
    .sort((a, b) => {
      // Primary sort: signal score (multi-source × source-tier × recency)
      if (b.signalScore !== a.signalScore) return b.signalScore! - a.signalScore!;
      // Tiebreak: raw recency
      return b.publishedAt.getTime() - a.publishedAt.getTime();
    });
}
