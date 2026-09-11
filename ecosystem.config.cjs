module.exports = {
  apps: [
    // The 4th "agent" is the resource server itself (the base "researcher")
    // — run separately (`npm run server`), not managed here as a pm2
    // process, so it isn't torn down/restarted independently of the human
    // running the demo.
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
