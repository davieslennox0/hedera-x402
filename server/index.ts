import { config } from "dotenv";
import express from "express";
import { paymentMiddleware } from "@x402/express";
import { resourceServer } from "./facilitator.js";

config();

const sellerAccountId = process.env.SELLER_ACCOUNT_ID;
const priceTinybars = process.env.PRICE_TINYBARS ?? "5000000"; // 0.05 HBAR
const port = Number(process.env.PORT ?? 4021);

if (!sellerAccountId) {
  console.error("Missing required SELLER_ACCOUNT_ID environment variable");
  process.exit(1);
}

const app = express();

app.use(
  paymentMiddleware(
    {
      "GET /paid/quote": {
        accepts: [
          {
            scheme: "exact",
            network: "hedera:testnet",
            payTo: sellerAccountId,
            // Explicit AssetAmount (not a "$x.xx" Money string) so this is
            // priced directly in native HBAR, asset "0.0.0" — see
            // server/facilitator.ts for why. Amount is in tinybars.
            price: { amount: priceTinybars, asset: "0.0.0" },
          },
        ],
        description: "Full market quote (paid tier)",
        mimeType: "application/json",
      },
    },
    resourceServer,
  ),
);

// Free preview — no payment header required, served before the paid route
// below so an unauthenticated GET still gets *something* useful back.
app.get("/paid/quote/preview", (_req, res) => {
  res.json({
    tier: "preview",
    symbol: "HBAR/USD",
    note: "Free preview. GET /paid/quote for the full quote (x402-gated).",
  });
});

// Gated route. paymentMiddleware intercepts requests without a valid
// X-PAYMENT header and returns 402 with `accepts` above; once Blocky402
// verifies + settles the payment, this handler runs and its response is
// what the client ultimately receives.
app.get("/paid/quote", (_req, res) => {
  res.json({
    tier: "paid",
    symbol: "HBAR/USD",
    price: 0.0721,
    asOf: new Date().toISOString(),
    depth: { bid: 12500, ask: 13100 },
  });
});

app.listen(port, () => {
  console.log(`Resource server listening at http://localhost:${port}`);
  console.log(`  free:  GET /paid/quote/preview`);
  console.log(`  paid:  GET /paid/quote  (x402-gated, settled via ${process.env.FACILITATOR_URL})`);
});
