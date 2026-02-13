import TelegramBot from "node-telegram-bot-api";
import { config } from "../config";
import { DigestMessage } from "../types";
import type { NewsCategory } from "./openai";

const bot = new TelegramBot(config.telegram.botToken);

const MAX_MESSAGE_LENGTH = 4000; // Telegram limit is 4096, leave buffer

const CATEGORY_HEADERS: Record<NewsCategory, string> = {
  ai: "🤖 AI 科技日報",
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
  ai: "AI 科技",
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

export async function sendWorldDigest(items: DigestMessage[]): Promise<void> {
  await sendDigest(config.telegram.financeGroupId, items, "world");
}

export async function sendFinanceDigest(items: DigestMessage[]): Promise<void> {
  await sendDigest(config.telegram.financeGroupId, items, "finance");
}
