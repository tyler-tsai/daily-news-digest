import dotenv from "dotenv";
dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required env variable: ${key}`);
  }
  return value;
}

export const config = {
  telegram: {
    botToken: requireEnv("TELEGRAM_BOT_TOKEN"),
    aiGroupId: requireEnv("TG_GROUP_AI"),
    financeGroupId: requireEnv("TG_GROUP_FINANCE"),
    // Separate bot/group for AI Trending — keeps the trending feed (which
    // sends one message per repo) out of the news digest chat. Falls back to
    // the main bot+AI group if not configured.
    trendingBotToken: process.env.TELEGRAM_BOT_TOKEN_TRENDING || requireEnv("TELEGRAM_BOT_TOKEN"),
    trendingGroupId: process.env.TG_GROUP_TRENDING || requireEnv("TG_GROUP_AI"),
  },
  openai: {
    apiKey: requireEnv("OPENAI_API_KEY"),
    model: "gpt-4o",
  },
  newsapi: {
    apiKey: requireEnv("NEWSAPI_KEY"),
  },
  discord: {
    aiWebhook: process.env.DISCORD_WEBHOOK_AI || "",
    financeWebhook: process.env.DISCORD_WEBHOOK_FINANCE || "",
  },
  cron: {
    schedule: process.env.CRON_SCHEDULE || "0 8 * * *",
    timezone: process.env.TZ || "Asia/Taipei",
  },
};
