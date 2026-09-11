import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import express from "express";
import { paymentMiddleware } from "@x402/express";
import { decodePaymentResponseHeader, decodePaymentSignatureHeader } from "@x402/core/http";
import { resourceServer } from "./facilitator.js";
import { recordSettlement, getActivity } from "./activity.js";

config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sellerAccountId = process.env.SELLER_ACCOUNT_ID;
const priceTinybars = process.env.PRICE_TINYBARS ?? "5000000"; // 0.05 HBAR
const port = Number(process.env.PORT ?? 4021);

if (!sellerAccountId) {
  console.error("Missing required SELLER_ACCOUNT_ID environment variable");
  process.exit(1);
}

const app = express();

// Serves dashboard/index.html at /dashboard so there's one process to run
// for the demo (no separate static file server needed).
app.use("/dashboard", express.static(path.join(__dirname, "..", "dashboard")));

// GET /activity — recent settled transactions, newest first. Polled by the
// dashboard. Populated by the settlement-observer middleware below.
app.get("/activity", (_req, res) => {
  res.json(getActivity());
});

// Observes the outcome of paymentMiddleware's verify/settle round trip
// rather than duplicating it: on 402->pay->settle success, paymentMiddleware
// attaches a base64 PAYMENT-RESPONSE header (the same one the client decodes
// via x402HTTPClient.getPaymentSettleResponse) to the eventual 200 response.
// We just read that header back off `res` once the response has gone out,
// and pull the paid amount from the client's own PAYMENT-SIGNATURE request
// header (its `accepted.amount`), since SettleResponse.amount is only set
// for schemes where settled amount can differ from requested (not `exact`).
app.use((req, res, next) => {
  res.on("finish", () => {
    const settlementHeader = res.getHeader("PAYMENT-RESPONSE");
    if (typeof settlementHeader !== "string") return;

    let amountTinybars = "unknown";
    const sigHeader = req.header("PAYMENT-SIGNATURE");
    if (sigHeader) {
      try {
        amountTinybars = decodePaymentSignatureHeader(sigHeader).accepted?.amount ?? "unknown";
      } catch {
        /* leave as "unknown" */
      }
    }

    try {
      const settlement = decodePaymentResponseHeader(settlementHeader);
      if (!settlement.success) return;
      recordSettlement({
        timestamp: new Date().toISOString(),
        txId: settlement.transaction,
        amountTinybars,
        buyer: settlement.payer,
        seller: sellerAccountId!,
        status: "settled",
      });
    } catch (err) {
      console.error("Failed to decode PAYMENT-RESPONSE for activity log:", err);
    }
  });
  next();
});

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
  console.log(`  free:      GET /paid/quote/preview`);
  console.log(`  paid:      GET /paid/quote  (x402-gated, settled via ${process.env.FACILITATOR_URL})`);
  console.log(`  activity:  GET /activity`);
  console.log(`  dashboard: GET /dashboard`);
});
