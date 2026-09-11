module.exports = {
  apps: [
    // The 4th "agent" is the resource server itself (the base "researcher").
    // Originally run manually (outside pm2) so a demo recording session
    // could restart it independently of the other agents — but this now
    // backs the live qorbitpay.xyz site via Caddy reverse proxy, so it
    // needs to survive host reboots / session boundaries the same way the
    // requester agents already do. pm2-managed since 2026-09-11.
    {
      name: "hedera-server",
      script: "server/index.ts",
      interpreter: "node",
      interpreter_args: "--import tsx",
      cwd: __dirname,
      autorestart: true,
      max_restarts: 20,
    },
    {
      name: "hedera-requester-term-paper",
      script: "agents/requester-term-paper.ts",
      interpreter: "node",
      interpreter_args: "--import tsx",
      cwd: __dirname,
      autorestart: true,
      max_restarts: 20,
    },
    {
      name: "hedera-requester-news-a",
      script: "agents/requester-news-a.ts",
      interpreter: "node",
      interpreter_args: "--import tsx",
      cwd: __dirname,
      autorestart: true,
      max_restarts: 20,
    },
    {
      name: "hedera-requester-news-b",
      script: "agents/requester-news-b.ts",
      interpreter: "node",
      interpreter_args: "--import tsx",
      cwd: __dirname,
      autorestart: true,
      max_restarts: 20,
    },
    {
      name: "hedera-treasury-rotator",
      script: "agents/treasury-rotator.ts",
      interpreter: "node",
      interpreter_args: "--import tsx",
      cwd: __dirname,
      autorestart: true,
      max_restarts: 20,
    },
  ],
};
