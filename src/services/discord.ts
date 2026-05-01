import { config } from "../config";
import { DigestMessage } from "../types";
import type { NewsCategory } from "./openai";

const MAX_LENGTH = 2000;

const CATEGORY_HEADERS: Record<NewsCategory, string> = {
  ai: "🤖 AI 科技日報",
  world: "🌍 國際新聞日報",
  finance: "📊 國際財經與美股日報",
};

const CATEGORY_EMPTY_LABELS: Record<NewsCategory, string> = {
  ai: "AI 科技",
  world: "國際",
  finance: "國際財經",
};

function formatDigest(items: DigestMessage[], category: NewsCategory): string[] {
  const now = new Date().toLocaleDateString("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const header = `**${CATEGORY_HEADERS[category]}** — ${now}\n${"═".repeat(28)}`;

  const formattedItems = items.map((item, i) => {
    const title = `**${i + 1}. ${item.title}**`;
    const summary = item.summary ? `\n   ${item.summary}` : "";
    const link = `\n   [Read more](${item.url})`;
    return title + summary + link;
  });

  const messages: string[] = [];
  let current = header + "\n\n";

  for (const item of formattedItems) {
    if ((current + item + "\n").length > MAX_LENGTH) {
      messages.push(current.trim());
      current = item + "\n";
    } else {
      current += item + "\n";
    }
  }
  if (current.trim()) messages.push(current.trim());

  return messages;
}

async function sendToWebhook(webhookUrl: string, text: string): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: text }),
  });
  if (!res.ok) throw new Error(`Discord ${res.status}: ${await res.text()}`);
}

async function sendDigest(
  webhookUrl: string,
  items: DigestMessage[],
  category: NewsCategory
): Promise<void> {
  if (!webhookUrl) return;

  if (items.length === 0) {
    await sendToWebhook(webhookUrl, `⚠️ 今日暫無${CATEGORY_EMPTY_LABELS[category]}新聞更新`);
    return;
  }

  const messages = formatDigest(items, category);
  for (const msg of messages) {
    try {
      await sendToWebhook(webhookUrl, msg);
      if (messages.length > 1) await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      console.error(`[Discord] Failed to send message: ${err}`);
    }
  }
}

export async function sendAIDigestDiscord(items: DigestMessage[]): Promise<void> {
  await sendDigest(config.discord.aiWebhook, items, "ai");
}

export async function sendWorldDigestDiscord(items: DigestMessage[]): Promise<void> {
  await sendDigest(config.discord.financeWebhook, items, "world");
}

export async function sendFinanceDigestDiscord(items: DigestMessage[]): Promise<void> {
  await sendDigest(config.discord.financeWebhook, items, "finance");
}
