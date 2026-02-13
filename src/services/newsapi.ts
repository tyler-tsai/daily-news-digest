import NewsAPI from "newsapi";
import { config } from "../config";
import { NewsItem } from "../types";

const newsapi = new NewsAPI(config.newsapi.apiKey);

export async function fetchAINews(): Promise<NewsItem[]> {
  try {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const response = await newsapi.v2.everything({
      q: '("artificial intelligence" OR "machine learning" OR "LLM" OR "GPT" OR "OpenAI" OR "Claude" OR "Gemini" OR "AI model")',
      from: yesterday,
      language: "en",
      sortBy: "publishedAt",
      pageSize: 30,
    });

    return (response.articles || []).map((a: any) => ({
      title: a.title || "Untitled",
      description: (a.description || "").slice(0, 500),
      url: a.url || "",
      source: a.source?.name || "Unknown",
      publishedAt: new Date(a.publishedAt),
    }));
  } catch (err) {
    console.warn(`[NewsAPI] Failed to fetch AI news: ${err}`);
    return [];
  }
}

export async function fetchFinanceNews(): Promise<NewsItem[]> {
  try {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const response = await newsapi.v2.topHeadlines({
      category: "business",
      language: "en",
      pageSize: 30,
    });

    const everythingResponse = await newsapi.v2.everything({
      q: '("stock market" OR "S&P 500" OR "NASDAQ" OR "Fed" OR "Wall Street" OR "earnings" OR "geopolitics")',
      from: yesterday,
      language: "en",
      sortBy: "publishedAt",
      pageSize: 20,
    });

    const articles = [
      ...(response.articles || []),
      ...(everythingResponse.articles || []),
    ];

    return articles.map((a: any) => ({
      title: a.title || "Untitled",
      description: (a.description || "").slice(0, 500),
      url: a.url || "",
      source: a.source?.name || "Unknown",
      publishedAt: new Date(a.publishedAt),
    }));
  } catch (err) {
    console.warn(`[NewsAPI] Failed to fetch finance news: ${err}`);
    return [];
  }
}
