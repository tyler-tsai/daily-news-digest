import OpenAI from "openai";
import { config } from "../config";
import { NewsItem, DigestMessage } from "../types";
import type { TrendingRepo } from "./githubTrending";

const openai = new OpenAI({ apiKey: config.openai.apiKey });

export type NewsCategory = "ai" | "ai-builder" | "world" | "finance";

const CATEGORY_CONFIG: Record<NewsCategory, { maxItems: number; pickCount: string; label: string; scopeHint: string }> = {
    ai: {
        maxItems: 30,
        pickCount: "8-12",
        label: "AI 產業",
        scopeHint:
            "AI 公司動態、商業合作、募資/IPO、訴訟、監管、產業評論。屬於 corporate news 性質。排除純技術、library、模型 release 類技術文章（這些屬於 AI 工程分類）",
    },
    "ai-builder": {
        maxItems: 35,
        pickCount: "8-12",
        label: "AI 工程與工具",
        scopeHint:
            "工程師如何實際使用 AI 的技術內容，包括：(1) 開源/開權重模型 release（Llama / Qwen / DeepSeek / Mistral 等），尤其能本地跑的；(2) 新 library / framework / SDK / 工具（agent framework、RAG、inference 加速、eval、prompt engineering 工具等）；(3) 實際 production case study（怎麼把 AI 整合進產品、實作教學）；(4) 新方法論（fine-tuning、RL、distillation、reasoning、context engineering 等）；(5) benchmark 與評測。排除：corporate news（合作、IPO、訴訟、財報）、空泛的 'AI is changing everything' 類評論文",
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
    // Items are already sorted by signal score (cluster.ts); take top N
    const topItems = items.slice(0, cfg.maxItems);

    const newsListText = topItems
        .map((item, i) => {
            // Surface signal metadata so the LLM can prefer multi-source stories
            const signalCount = item.signalCount ?? 1;
            const sourceList =
                item.sources && item.sources.length > 1
                    ? item.sources.join(", ")
                    : item.source;
            const signalTag =
                signalCount >= 2
                    ? `[訊號強度=${signalCount} 來源: ${sourceList}]`
                    : `[單一來源: ${item.source}]`;
            return `${i + 1}. ${signalTag} ${item.title}\n   ${item.description}\n   URL: ${item.url}`;
        })
        .join("\n\n");

    const prompt = `你是一位專業的新聞編輯。請從以下新聞列表中，挑選熱度最高、最重要的 ${cfg.pickCount} 條新聞。

排序原則（最重要）：
A. 訊號強度優先：被 2+ 個獨立來源同時報導的新聞 (訊號強度 >= 2) 比單一來源報導更有價值，應優先選入
B. 一手來源優先：當同一事件出現在多個來源，引用 OpenAI / Anthropic / Google AI / DeepMind / Bloomberg / FT / The Economist 等官方或一手來源
C. 排除：產品評測列表（"top 10", "best of"）、軟性置入廣告、未經第三方確認的小道消息

內容要求：
1. title：精煉的中文標題，15-25字，點出核心事件
2. summary：2-3句中文摘要（50-100字），補充關鍵數據、背景脈絡與市場影響，讓讀者不用點進去就能掌握重點
3. 保留原始 URL
4. 領域：${cfg.label}
5. 選題範圍：${cfg.scopeHint}
6. 只選近24小時內的新聞
7. 相似主題的新聞請合併為一條（系統已預先做了 clustering，每條訊號強度 >=2 的項目本身就是合併過的）

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
        const fallbackCount =
            category === "ai" ? 10 :
            category === "ai-builder" ? 10 :
            category === "world" ? 8 :
            12;
        return topItems.slice(0, fallbackCount).map((item) => ({
            title: item.title,
            url: item.url,
            source: item.source,
        }));
    }
}

export type RepoTopic =
    | "agent"
    | "dev-tool"
    | "model"
    | "infra"
    | "framework"
    | "skill-pack"
    | "other";

export interface RepoSummary {
    summary: string;
    topic: RepoTopic;
}

const ALLOWED_TOPICS: RepoTopic[] = [
    "agent",
    "dev-tool",
    "model",
    "infra",
    "framework",
    "skill-pack",
    "other",
];

/**
 * Generate 1-2 sentence Chinese hook + topic tag for each trending repo.
 * Single batched call. The hook must add context the description doesn't —
 * lazy "適合 X 開發者" patterns are explicitly forbidden in the prompt.
 */
export async function summarizeRepos(
    repos: TrendingRepo[]
): Promise<Map<string, RepoSummary>> {
    const result = new Map<string, RepoSummary>();
    if (repos.length === 0) return result;

    const reposText = repos
        .map(
            (r, i) =>
                `${i + 1}. ${r.fullName}\n   description: ${r.description || "(no description)"}\n   language: ${r.language ?? "—"}, total stars: ${r.totalStars}`
        )
        .join("\n\n");

    const prompt = `你是 AI 工程編輯。為每個 GitHub trending repo 寫 1-2 句中文簡介 + 標記主題類別，幫工程師判斷要不要點進去。

【簡介規則】
1. 每條 25-50 字，1-2 句
2. **禁用句式**（出現視為失敗）：「適合 X 開發者」、「適合需要 X 的人」、「適合 X 工程師」、「適合需要 X 的開發者」
3. 必須含技術 differentiator — 用什麼技術做的 / 跟其他類似工具差在哪 / 有什麼特殊 feature
4. 假設讀者已看過英文 description；要補充判斷或 distill，不要翻譯
5. 技術名詞保留英文：LLM, agent, framework, MCP, RAG, Claude Code, SDK, inference, swarm, fine-tune, embedding, vector DB 等

【正例 vs 反例 — 演示句式結構，不准照抄字串】
✗ 反例（禁用句式）：".... ，適合需要 X 的開發者"
✓ 正例結構：「[實作語言] 寫的 [類型]，[特點1]+[特點2]，[USP/比較點]」

假設範例（fakeorg/fake-llm-cache，純演示，不要抄這些字）：
   "Go 寫的 LLM proxy cache，TTL + token-aware 估算，宣稱對 GPT-4o 路徑省 40% 成本"
（注意：實際 summary 必須根據每個 repo 真實內容寫，這只是示範句式架構）

【集合類判定 — 重要】
以下任一滿足 → topic 設 "skill-pack"，summary 必須以「skill/prompt 集合：」開頭，明確說「非可執行工具」：
- repo 名稱含 "skills"、"prompts"、"awesome-X"、"-pack"、"-collection"
- description 提到 .claude/、.cursor/ 目錄、CLAUDE.md 檔案
- description 出現 "curated list"、"collection of"、"prompts for"、"straight from my .claude"
- language 是 Shell / 空 / Markdown，且 description 沒提到實際程式碼/runtime

【主題類別 topic（必選一個）】
- "agent": agent framework, orchestration, multi-agent, swarm, agentic workflow
- "dev-tool": CLI tool, IDE plugin, coding assistant, terminal app, VSCode extension
- "model": 模型權重 / 訓練 / fine-tune / 模型架構 / pretrained
- "infra": inference engine, MCP server, vector DB, RAG infra, serving, gateway, proxy
- "framework": general application framework, SDK, library
- "skill-pack": prompt/skill markdown collection (見上面判定)
- "other": 上面都不適用

【輸出格式】回 JSON object（不要加 markdown code block）：
{
  "summaries": [
    { "fullName": "owner/repo", "summary": "中文簡介...", "topic": "agent" }
  ]
}

Repos:
${reposText}`;

    try {
        const response = await openai.chat.completions.create({
            model: config.openai.model,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.3,
            response_format: { type: "json_object" },
        });
        const content = response.choices[0]?.message?.content?.trim();
        if (!content) return result;
        const parsed = JSON.parse(content) as {
            summaries?: { fullName: string; summary: string; topic?: string }[];
        };
        for (const s of parsed.summaries ?? []) {
            if (!s.fullName || !s.summary) continue;
            const topic: RepoTopic = ALLOWED_TOPICS.includes(s.topic as RepoTopic)
                ? (s.topic as RepoTopic)
                : "other";
            result.set(s.fullName, { summary: s.summary, topic });
        }
    } catch (err) {
        console.error(`[OpenAI] Repo summary failed: ${err}`);
    }
    return result;
}
