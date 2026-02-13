import cron from "node-cron";
import { config } from "./config";
import { runAINewsJob } from "./jobs/ai-news";
import { runFinanceNewsJob } from "./jobs/finance-news";

console.log("📰 Daily News Digest Service starting...");
console.log(`   Schedule: ${config.cron.schedule} (${config.cron.timezone})`);
console.log(`   AI News  → TG Group: ${config.telegram.aiGroupId}`);
console.log(`   Finance  → TG Group: ${config.telegram.financeGroupId}`);

// Schedule AI News job
cron.schedule(
  config.cron.schedule,
  async () => {
    console.log("\n--- AI News Job Triggered ---");
    await runAINewsJob();
  },
  { timezone: config.cron.timezone }
);

// Schedule Finance News job (5 minutes after AI news to spread load)
const [minute, ...rest] = config.cron.schedule.split(" ");
const financeMinute = String(Math.min(Number(minute) + 5, 59));
const financeSchedule = [financeMinute, ...rest].join(" ");

cron.schedule(
  financeSchedule,
  async () => {
    console.log("\n--- Finance News Job Triggered ---");
    await runFinanceNewsJob();
  },
  { timezone: config.cron.timezone }
);

console.log("✅ Cron jobs registered. Waiting for next trigger...\n");

// Handle manual trigger via CLI argument
if (process.argv.includes("--run-now")) {
  console.log("🔄 Manual trigger: running both jobs now...\n");
  (async () => {
    await runAINewsJob();
    await runFinanceNewsJob();
    console.log("\n✅ Manual run completed.");
  })();
}
