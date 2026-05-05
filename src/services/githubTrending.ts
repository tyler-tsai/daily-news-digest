import * as cheerio from "cheerio";

export interface TrendingRepo {
  owner: string;
  name: string;
  fullName: string; // owner/name
  url: string;
  description: string;
  language: string | null;
  totalStars: number;
  totalForks: number;
  starsInWindow: number;
  windowLabel: TrendingWindow;
}

export type TrendingWindow = "daily" | "weekly" | "monthly";

const WINDOW_LABEL: Record<TrendingWindow, string> = {
  daily: "today",
  weekly: "this week",
  monthly: "this month",
};

/**
 * Scrape github.com/trending. There's no official trending API, and the only
 * RSS proxy (mshibanami's) drops the star-delta which is the metric that
 * actually matters for "what's hot right now".
 */
export async function fetchTrending(
  since: TrendingWindow = "daily",
  language: string = ""
): Promise<TrendingRepo[]> {
  const url = `https://github.com/trending${language ? "/" + encodeURIComponent(language) : ""}?since=${since}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 daily-news-digest/1.0",
      Accept: "text/html",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new Error(`GitHub trending fetch failed (${since}): HTTP ${res.status}`);
  }
  return parseTrendingHTML(await res.text(), since);
}

function parseTrendingHTML(html: string, since: TrendingWindow): TrendingRepo[] {
  const $ = cheerio.load(html);
  const repos: TrendingRepo[] = [];

  $("article.Box-row").each((_, el) => {
    const $el = $(el);

    // Repo path: <h2 class="h3 lh-condensed"><a href="/owner/repo">
    const link = $el.find("h2 a").first().attr("href") || "";
    const m = link.match(/^\/([^\/]+)\/([^\/?#]+)/);
    if (!m) return;
    const [, owner, name] = m;

    // Description: <p class="col-9 color-fg-muted my-1 ...">
    const description = $el.find("p.col-9").first().text().trim();

    // Language: <span itemprop="programmingLanguage">
    const language =
      $el.find('[itemprop="programmingLanguage"]').first().text().trim() || null;

    // Total stars: <a href="/owner/repo/stargazers"> shows the count text
    const starsRaw = $el.find('a[href$="/stargazers"]').first().text().trim();
    const totalStars = parseCompactInt(starsRaw);

    // Total forks
    const forksRaw = $el.find('a[href$="/forks"]').first().text().trim();
    const totalForks = parseCompactInt(forksRaw);

    // Stars in window: ".float-sm-right" contains "N stars today/week/month"
    const windowText = $el.find("span.float-sm-right").first().text().trim();
    const wMatch = windowText.match(/([\d,]+)\s+stars?\s+/);
    const starsInWindow = wMatch ? parseCompactInt(wMatch[1]) : 0;

    repos.push({
      owner,
      name,
      fullName: `${owner}/${name}`,
      url: `https://github.com/${owner}/${name}`,
      description,
      language,
      totalStars,
      totalForks,
      starsInWindow,
      windowLabel: since,
    });
  });

  return repos;
}

function parseCompactInt(s: string): number {
  if (!s) return 0;
  const cleaned = s.replace(/,/g, "").trim();
  const n = parseInt(cleaned, 10);
  return Number.isNaN(n) ? 0 : n;
}

// Broad AI vocabulary — biased toward recall over precision because trending
// repos with obviously-AI names sometimes have terse descriptions like "an LLM
// inference engine" that miss specific keywords.
const AI_REGEX =
  /\b(ai|llm|llms|gpt|claude|gemini|llama|qwen|deepseek|mistral|grok|sora|kimi|phi[-\s]?\d|openai|anthropic|deepmind|huggingface|hugging[-\s]?face|chatgpt|copilot|cursor|codex|cline|devin|aider|continue\s+dev|model|models|neural|transformer|inference|embedding|embeddings|rag\b|fine[-\s]?tun|agent|agents|agentic|prompt|prompts|reasoning|reinforcement|diffusion|machine[-\s]?learning|deep[-\s]?learning|mlops?|generative|nlp|speech[-\s]?to[-\s]?text|text[-\s]?to[-\s]?image|chatbot|voice[-\s]?ai|multimodal|vector[-\s]?(db|database|search)|retrieval|stable[-\s]?diffusion|midjourney|whisper|tts|stt|comfyui|ollama|vllm|langchain|langgraph|llamaindex|llamacpp|llama\.cpp|tensorrt|triton|onnx|pytorch|tensorflow|jax\b|cuda|gpu)\b/i;

export function isAIRepo(repo: TrendingRepo): boolean {
  // Match against repo name OR description — descriptions can be terse
  return AI_REGEX.test(repo.fullName) || AI_REGEX.test(repo.description);
}

/** Fetch all three windows in parallel and filter for AI relevance. */
export async function fetchAITrending(): Promise<{
  daily: TrendingRepo[];
  weekly: TrendingRepo[];
  monthly: TrendingRepo[];
}> {
  const [daily, weekly, monthly] = await Promise.allSettled([
    fetchTrending("daily"),
    fetchTrending("weekly"),
    fetchTrending("monthly"),
  ]);

  const pick = (r: PromiseSettledResult<TrendingRepo[]>): TrendingRepo[] =>
    r.status === "fulfilled" ? r.value.filter(isAIRepo) : [];

  return {
    daily: pick(daily),
    weekly: pick(weekly),
    monthly: pick(monthly),
  };
}
