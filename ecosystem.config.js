module.exports = {
  apps: [
    {
      name: "daily-news-digest",
      script: "node_modules/.bin/tsx",
      args: "src/index.ts",
      cwd: __dirname,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        NODE_ENV: "production",
        TZ: "Asia/Taipei",
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "logs/error.log",
      out_file: "logs/out.log",
      merge_logs: true,
    },
  ],
};
