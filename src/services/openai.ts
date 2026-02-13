import OpenAI from "openai";
import { config } from "../config";
import { NewsItem, DigestMessage } from "../types";

const openai = new OpenAI({ apiKey: config.openai.apiKey });

export async function summarizeNews(
  items: NewsItem[],
  category: "ai" | "finance"
): Promise<DigestMessage[]> {
  if (items.length === 0) return [];

  const maxItems = category === "ai" ? 30 : 50;
  const topItems = items.slice(0, maxItems);

  const newsListText = topItems
    .map(
      (item, i) =>
        `${i + 1}. [${item.source}] ${item.title}\n   ${item.description}\n   URL: ${item.url}`
    )
    .join("\n\n");

  const pickCount = category === "ai" ? "10-15" : "18-25";
  const categoryLabel =
    category === "ai" ? "AI 科技" : "國際財經與美股";

  const prompt = `你是一位專業的新聞編輯。請從以下新聞列表中，挑選熱度最高、最重要的 ${pickCount} 條新聞。

要求：
1. 用簡短的繁體中文標題（一句話，15字以內為佳）
2. 按熱度/重要性排序
3. 保留原始 URL
4. 領域：${categoryLabel}
5. 只選近24小時內的新聞

請用以下 JSON 格式回覆（直接回覆 JSON array，不要加 markdown code block）：
[
  {
    "title": "簡短中文標題",
    "url": "原始連結",
    "source": "來源名稱"
  }
]

新聞列表：
${newsListText}`;

  try {
    const response = await openai.chat.completions.create({
      model: config.openai.model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 3000,
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) return [];

    // Try to parse JSON, handling possible markdown code blocks
    const jsonStr = content.replace(/^```json?\n?/, "").replace(/\n?```$/, "");
    return JSON.parse(jsonStr) as DigestMessage[];
  } catch (err) {
    console.error(`[OpenAI] Summarization failed: ${err}`);
    const fallbackCount = category === "ai" ? 10 : 20;
    return topItems.slice(0, fallbackCount).map((item) => ({
      title: item.title,
      url: item.url,
      source: item.source,
    }));
  }
}
