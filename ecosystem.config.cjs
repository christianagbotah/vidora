module.exports = {
  apps: [
    {
      name: "vidora",
      script: ".next/standalone/server.js",
      cwd: "/home/lightworld/webapps/vidora",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        HOSTNAME: "0.0.0.0",
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      error_file: "/home/lightworld/webapps/vidora/logs/error.log",
      out_file: "/home/lightworld/webapps/vidora/logs/out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
