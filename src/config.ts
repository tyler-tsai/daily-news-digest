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
  },
  openai: {
    apiKey: requireEnv("OPENAI_API_KEY"),
    model: "gpt-4o",
  },
  newsapi: {
    apiKey: requireEnv("NEWSAPI_KEY"),
  },
  cron: {
    schedule: process.env.CRON_SCHEDULE || "0 8 * * *",
    timezone: process.env.TZ || "Asia/Taipei",
  },
};
