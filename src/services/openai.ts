import OpenAI from "openai";
import { config } from "../config";
import { NewsItem, DigestMessage } from "../types";

const openai = new OpenAI({ apiKey: config.openai.apiKey });

export type NewsCategory = "ai" | "world" | "finance";

const CATEGORY_CONFIG: Record<NewsCategory, { maxItems: number; pickCount: string; label: string; scopeHint: string }> = {
    ai: {
        maxItems: 30,
        pickCount: "10-15",
        label: "AI 科技",
        scopeHint: "人工智慧、機器學習、大型語言模型、科技產業等相關新聞",
    },
    world: {
        maxItems: 50,
        pickCount: "8-12",
        label: "國際新聞",
        scopeHint: "國際政治、地緣衝突、外交關係、社會重大事件等非財經類國際新聞。排除純粹的股市、金融、企業財報類新聞",
    },
    finance: {
        maxItems: 50,
        pickCount: "10-15",
        label: "國際財經與美股",
        scopeHint: "股市走勢、企業財報、央行政策、經濟數據、大宗商品、加密貨幣等財經與美股相關新聞。排除純粹的國際政治或地緣衝突新聞",
    },
};

export async function summarizeNews(
    items: NewsItem[],
    category: NewsCategory
): Promise<DigestMessage[]> {
    if (items.length === 0) return [];

    const cfg = CATEGORY_CONFIG[category];
    const topItems = items.slice(0, cfg.maxItems);

    const newsListText = topItems
        .map(
            (item, i) =>
                `${i + 1}. [${item.source}] ${item.title}\n   ${item.description}\n   URL: ${item.url}`
        )
        .join("\n\n");

    const prompt = `你是一位專業的新聞編輯。請從以下新聞列表中，挑選熱度最高、最重要的 ${cfg.pickCount} 條新聞。

要求：
1. title：精煉的中文標題，15-25字，點出核心事件
2. summary：2-3句中文摘要（50-100字），補充關鍵數據、背景脈絡與市場影響，讓讀者不用點進去就能掌握重點
3. 按熱度/重要性排序
4. 保留原始 URL
5. 領域：${cfg.label}
6. 選題範圍：${cfg.scopeHint}
7. 只選近24小時內的新聞
8. 相似主題的新聞請合併為一條

請用以下 JSON 格式回覆（直接回覆 JSON array，不要加 markdown code block）：
[
  {
    "title": "精煉中文標題",
    "summary": "2-3句中文摘要，包含關鍵數據與影響",
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
            max_tokens: 4500,
        });

        const content = response.choices[0]?.message?.content?.trim();
        if (!content) return [];

        // Try to parse JSON, handling possible markdown code blocks
        const jsonStr = content.replace(/^```json?\n?/, "").replace(/\n?```$/, "");
        return JSON.parse(jsonStr) as DigestMessage[];
    } catch (err) {
        console.error(`[OpenAI] Summarization failed: ${err}`);
        const fallbackCount = category === "ai" ? 10 : category === "world" ? 8 : 12;
        return topItems.slice(0, fallbackCount).map((item) => ({
            title: item.title,
            url: item.url,
            source: item.source,
        }));
    }
}
