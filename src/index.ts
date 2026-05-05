import cron from "node-cron";
import { config } from "./config";
import { runAINewsJob } from "./jobs/ai-news";
import { runAIBuilderJob } from "./jobs/ai-builder";
import { runFinanceNewsJob } from "./jobs/finance-news";

console.log("📰 Daily News Digest Service starting...");
console.log(`   Schedule: ${config.cron.schedule} (${config.cron.timezone})`);
console.log(`   AI News    → TG Group: ${config.telegram.aiGroupId}`);
console.log(`   AI Builder → TG Group: ${config.telegram.aiGroupId}`);
console.log(`   Finance    → TG Group: ${config.telegram.financeGroupId}`);

// Offset a cron schedule by N minutes; rolls over the hour properly.
// Returns the original schedule if the minute field isn't a plain number.
function offsetSchedule(schedule: string, minutes: number): string {
  const parts = schedule.split(" ");
  const minute = Number(parts[0]);
  if (Number.isNaN(minute)) return schedule;
  const total = minute + minutes;
  parts[0] = String(total % 60);
  // If we rolled past the hour and the hour field is numeric, bump it
  const hour = Number(parts[1]);
  if (total >= 60 && !Number.isNaN(hour)) {
    parts[1] = String((hour + Math.floor(total / 60)) % 24);
  }
  return parts.join(" ");
}

const schedules = {
  ai: config.cron.schedule,
  builder: offsetSchedule(config.cron.schedule, 5),
  finance: offsetSchedule(config.cron.schedule, 10),
};

cron.schedule(
  schedules.ai,
  async () => {
    console.log("\n--- AI News Job Triggered ---");
    await runAINewsJob();
  },
  { timezone: config.cron.timezone }
);

cron.schedule(
  schedules.builder,
  async () => {
    console.log("\n--- AI Builder Job Triggered ---");
    await runAIBuilderJob();
  },
  { timezone: config.cron.timezone }
);

cron.schedule(
  schedules.finance,
  async () => {
    console.log("\n--- Finance News Job Triggered ---");
    await runFinanceNewsJob();
  },
  { timezone: config.cron.timezone }
);

console.log(
  `✅ Cron jobs registered (AI=${schedules.ai}, Builder=${schedules.builder}, Finance=${schedules.finance}). Waiting for next trigger...\n`
);

// Handle manual trigger via CLI argument.
// Forms: --run-now (all), --run-now=ai, --run-now=ai-builder, --run-now=finance
const runNowArg = process.argv.find(
  (a) => a === "--run-now" || a.startsWith("--run-now=")
);
if (runNowArg) {
  const target = runNowArg.includes("=") ? runNowArg.split("=")[1] : "all";

  console.log(`🔄 Manual trigger: target=${target}\n`);
  (async () => {
    if (target === "all" || target === "ai") await runAINewsJob();
    if (target === "all" || target === "ai-builder") await runAIBuilderJob();
    if (target === "all" || target === "finance") await runFinanceNewsJob();
    console.log("\n✅ Manual run completed.");
    process.exit(0);
  })();
}
