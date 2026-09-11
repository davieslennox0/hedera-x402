module.exports = {
  apps: [
    {
      name: "hedera-buyer-agent",
      script: "agents/buyer-agent.ts",
      interpreter: "node",
      interpreter_args: "--import tsx",
      cwd: __dirname,
      autorestart: true,
      max_restarts: 20,
    },
    {
      name: "hedera-seller-monitor",
      script: "agents/seller-monitor.ts",
      interpreter: "node",
      interpreter_args: "--import tsx",
      cwd: __dirname,
      autorestart: true,
      max_restarts: 20,
    },
  ],
};
