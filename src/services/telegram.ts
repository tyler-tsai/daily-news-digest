import TelegramBot from "node-telegram-bot-api";
import { config } from "../config";
import { DigestMessage } from "../types";
import type { NewsCategory, RepoSummary, RepoTopic } from "./openai";
import type { TrendingRepo } from "./githubTrending";

const bot = new TelegramBot(config.telegram.botToken);
// Separate bot for AI Trending feed — distinct chat, distinct identity.
// Falls back to the main bot if TELEGRAM_BOT_TOKEN_TRENDING is not configured.
const trendingBot =
  config.telegram.trendingBotToken === config.telegram.botToken
    ? bot
    : new TelegramBot(config.telegram.trendingBotToken);

const MAX_MESSAGE_LENGTH = 4000; // Telegram limit is 4096, leave buffer

const CATEGORY_HEADERS: Record<NewsCategory, string> = {
  ai: "🤖 AI 產業日報",
  "ai-builder": "🛠️ AI 工程與工具日報",
  world: "🌍 國際新聞日報",
  finance: "📊 國際財經與美股日報",
};

function formatDigest(items: DigestMessage[], category: NewsCategory): string[] {
  const now = new Date().toLocaleDateString("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const header = `${CATEGORY_HEADERS[category]} — ${now}\n${"═".repeat(28)}`;

  const formattedItems = items.map((item, i) => {
    const title = `${i + 1}. <b>${escapeHtml(item.title)}</b>`;
    const summary = item.summary ? `\n   ${escapeHtml(item.summary)}` : "";
    const link = `\n   <a href="${item.url}">Read more</a>`;
    return title + summary + link;
  });

  // Split into multiple messages if too long
  const messages: string[] = [];
  let currentMessage = header + "\n\n";

  for (const item of formattedItems) {
    if (currentMessage.length + item.length + 2 > MAX_MESSAGE_LENGTH) {
      messages.push(currentMessage.trim());
      currentMessage = "";
    }
    currentMessage += item + "\n";
  }

  if (currentMessage.trim()) {
    messages.push(currentMessage.trim());
  }

  return messages;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const CATEGORY_EMPTY_LABELS: Record<NewsCategory, string> = {
  ai: "AI 產業",
  "ai-builder": "AI 工程",
  world: "國際",
  finance: "國際財經",
};

export async function sendDigest(
  chatId: string,
  items: DigestMessage[],
  category: NewsCategory
): Promise<void> {
  if (items.length === 0) {
    await bot.sendMessage(chatId, `⚠️ 今日暫無${CATEGORY_EMPTY_LABELS[category]}新聞更新`);
    return;
  }

  const messages = formatDigest(items, category);

  for (const msg of messages) {
    try {
      await bot.sendMessage(chatId, msg, {
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
      // Delay between messages to avoid rate limiting
      if (messages.length > 1) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch (err) {
      console.error(`[Telegram] Failed to send message: ${err}`);
    }
  }
}

export async function sendAIDigest(items: DigestMessage[]): Promise<void> {
  await sendDigest(config.telegram.aiGroupId, items, "ai");
}

export async function sendAIBuilderDigest(items: DigestMessage[]): Promise<void> {
  // Builder content goes to the same AI group by default — engineering content
  // is the primary value-add, so it shares attention with biz news.
  await sendDigest(config.telegram.aiGroupId, items, "ai-builder");
}

// Topic badges — render alongside language so engineers can scan by category
const TOPIC_BADGE: Record<RepoTopic, string> = {
  agent: "🤖 agent",
  "dev-tool": "🛠️ dev-tool",
  model: "🧠 model",
  infra: "⚡ infra",
  framework: "🔧 framework",
  "skill-pack": "📚 skill-pack",
  other: "❓ other",
};

const DESC_MAX_CHARS = 320;

// Streak badge — only shown for daily section. Streak=1 = first sighting (🆕);
// streak >= 2 = continued momentum, with intensity bumping at 3 and 5+.
function streakBadge(streak: number | undefined): string {
  if (!streak || streak < 1) return "";
  if (streak === 1) return " · 🆕";
  if (streak === 2) return " · 🔥 連2日";
  if (streak === 3) return " · 🔥🔥 連3日";
  if (streak < 5) return ` · 🔥🔥 連${streak}日`;
  return ` · 🔥🔥🔥 連${streak}日`;
}

/**
 * Format a single trending repo card as HTML for Telegram. The Chinese summary
 * is for quick judgment; the English description is kept (longer cap) for
 * readers who want full context without clicking through.
 */
function formatRepoCard(
  r: TrendingRepo,
  idx: number,
  windowEmoji: string,
  meta?: RepoSummary,
  streak?: number
): string {
  const title = `${idx}. <b>${escapeHtml(r.fullName)}</b>`;
  const stars = `${windowEmoji} <b>+${formatNumber(r.starsInWindow)}</b> · ${formatNumber(r.totalStars)}★ total`;
  const lang = r.language ? ` · ${escapeHtml(r.language)}` : "";
  const topic = meta?.topic ? ` · ${TOPIC_BADGE[meta.topic]}` : "";
  const streakStr = streakBadge(streak);
  const summaryLine = meta?.summary
    ? `\n   💬 ${escapeHtml(meta.summary)}`
    : "";
  const desc = r.description
    ? `\n   ${escapeHtml(r.description.slice(0, DESC_MAX_CHARS))}${r.description.length > DESC_MAX_CHARS ? "…" : ""}`
    : "";
  const link = `\n   <a href="${r.url}">${r.url.replace("https://", "")}</a>`;
  return `${title}\n   ${stars}${lang}${topic}${streakStr}${summaryLine}${desc}${link}`;
}

function formatNumber(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`;
  return n.toString();
}

export interface TrendingDigest {
  daily: TrendingRepo[];
  weekly: TrendingRepo[];
  monthly: TrendingRepo[];
  // Map of fullName → Chinese hook + topic tag (optional; gracefully degrades)
  summaries?: Map<string, RepoSummary>;
  // Map of fullName → consecutive days on daily list (only used in daily section)
  dailyStreaks?: Map<string, number>;
}

export async function sendAITrendingDigest(d: TrendingDigest): Promise<void> {
  const chatId = config.telegram.trendingGroupId;
  const today = new Date().toLocaleDateString("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  if (d.daily.length === 0 && d.weekly.length === 0 && d.monthly.length === 0) {
    await trendingBot.sendMessage(chatId, `⚠️ 今日 GitHub Trending 無新 AI 趨勢 repo`);
    return;
  }

  const summary = (r: TrendingRepo) => d.summaries?.get(r.fullName);
  const sections: string[] = [];
  sections.push(`🛠️ <b>AI Trending Repos</b> — ${today}\n${"═".repeat(28)}`);

  if (d.daily.length > 0) {
    sections.push(
      `\n📈 <b>今日熱度</b> (Daily Top ${d.daily.length})\n` +
        d.daily
          .map((r, i) =>
            formatRepoCard(r, i + 1, "⭐", summary(r), d.dailyStreaks?.get(r.fullName))
          )
          .join("\n\n")
    );
  }

  if (d.weekly.length > 0) {
    sections.push(
      `\n📊 <b>本週累積</b> (Weekly Top ${d.weekly.length})\n` +
        d.weekly.map((r, i) => formatRepoCard(r, i + 1, "🔥", summary(r))).join("\n\n")
    );
  }

  if (d.monthly.length > 0) {
    sections.push(
      `\n🌟 <b>本月趨勢</b> (Monthly Top ${d.monthly.length})\n` +
        d.monthly.map((r, i) => formatRepoCard(r, i + 1, "💎", summary(r))).join("\n\n")
    );
  }

  // Split into chunks under Telegram's 4096-char limit
  const chunks: string[] = [];
  let cur = "";
  for (const section of sections) {
    if (cur.length + section.length + 2 > 4000) {
      chunks.push(cur.trim());
      cur = "";
    }
    cur += section + "\n";
  }
  if (cur.trim()) chunks.push(cur.trim());

  for (const chunk of chunks) {
    try {
      await trendingBot.sendMessage(chatId, chunk, {
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
      if (chunks.length > 1) await new Promise((r) => setTimeout(r, 1000));
    } catch (err) {
      console.error(`[Telegram] Failed to send trending chunk: ${err}`);
    }
  }
}

export async function sendWorldDigest(items: DigestMessage[]): Promise<void> {
  await sendDigest(config.telegram.financeGroupId, items, "world");
}

export async function sendFinanceDigest(items: DigestMessage[]): Promise<void> {
  await sendDigest(config.telegram.financeGroupId, items, "finance");
}
