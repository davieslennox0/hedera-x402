import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import express from "express";
import { paymentMiddleware } from "@x402/express";
import { decodePaymentResponseHeader, decodePaymentSignatureHeader } from "@x402/core/http";
import { resourceServer } from "./facilitator.js";
import { recordSettlement, getActivity } from "./activity.js";
import { groqComplete, GroqNotConfiguredError } from "./groq.js";

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

// Serves site/index.html (the explainer landing page) at "/" and
// dashboard/index.html at /dashboard — one process for the whole demo, no
// separate static file server needed. Mounted before the API routes below;
// express.static calls next() on any path with no matching file, so it
// never shadows /paid/*, /activity, etc.
app.use("/", express.static(path.join(__dirname, "..", "site")));
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
        kind: typeof res.locals.kind === "string" ? res.locals.kind : undefined,
        headline: typeof res.locals.headline === "string" ? res.locals.headline : undefined,
        snippet: typeof res.locals.snippet === "string" ? res.locals.snippet : undefined,
        content: typeof res.locals.content === "string" ? res.locals.content : undefined,
      });
    } catch (err) {
      console.error("Failed to decode PAYMENT-RESPONSE for activity log:", err);
    }
  });
  next();
});

app.use(express.json());

const termPaperPriceTinybars = process.env.RESEARCH_TERM_PAPER_PRICE_TINYBARS ?? "5000000"; // 0.05 HBAR
const newsPriceTinybars = process.env.RESEARCH_NEWS_PRICE_TINYBARS ?? "3000000"; // 0.03 HBAR

// The "researcher" base agent's two real deliverables are only mounted once
// there's a Groq key to actually fulfil them — see the GROQ_API_KEY check
// below. Settlement happens (real HBAR moves) BEFORE these route handlers
// ever run, since paymentMiddleware only calls through once Blocky402 has
// already verified + settled — so there's no way to charge for a broken
// endpoint after the fact. Not registering the route at all when
// unconfigured means a request 404s instead of paying for nothing.
const researchRoutes: Record<string, unknown> = {
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
};

if (process.env.GROQ_API_KEY) {
  researchRoutes["POST /paid/research/term-paper"] = {
    accepts: [
      {
        scheme: "exact",
        network: "hedera:testnet",
        payTo: sellerAccountId,
        price: { amount: termPaperPriceTinybars, asset: "0.0.0" },
      },
    ],
    description: "Term paper feedback from the researcher agent",
    mimeType: "application/json",
  };
  researchRoutes["POST /paid/research/news"] = {
    accepts: [
      {
        scheme: "exact",
        network: "hedera:testnet",
        payTo: sellerAccountId,
        price: { amount: newsPriceTinybars, asset: "0.0.0" },
      },
    ],
    description: "News analysis from the researcher agent",
    mimeType: "application/json",
  };
} else {
  console.warn(
    "GROQ_API_KEY not set — /paid/research/term-paper and /paid/research/news are not mounted " +
      "(requests will 404 rather than charge for a broken endpoint). /paid/quote still works.",
  );
}

app.use(paymentMiddleware(researchRoutes as Parameters<typeof paymentMiddleware>[0], resourceServer));

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

const TERM_PAPER_SYSTEM_PROMPT =
  "You are a rigorous but constructive academic writing tutor. Given an excerpt from a " +
  "student's term paper, give specific, actionable feedback: 2-3 concrete strengths, " +
  "2-3 concrete weaknesses (argument structure, evidence, clarity), and one prioritized next " +
  "revision step. Keep it under 200 words, no generic platitudes.";

const NEWS_SYSTEM_PROMPT =
  "You are a news analyst. Given a topic, provide a concise, balanced analysis: what's " +
  "currently notable about it, the main competing perspectives if any, and why it matters. " +
  "Keep it under 200 words. Note explicitly that this is a generated analysis, not a live " +
  "news feed — you have no real-time browsing access.";

// POST /paid/research/term-paper — real Groq-generated feedback on a paper
// excerpt. Only reachable if GROQ_API_KEY was set at startup (see above).
if (process.env.GROQ_API_KEY) {
  app.post("/paid/research/term-paper", async (req, res) => {
    res.locals.kind = "term-paper";
    const text = typeof req.body?.text === "string" ? req.body.text : undefined;
    if (!text) {
      res.status(400).json({ error: "Request body must include a `text` string" });
      return;
    }
    try {
      const feedback = await groqComplete(TERM_PAPER_SYSTEM_PROMPT, text);
      res.locals.headline = `Review: ${text.slice(0, 40)}${text.length > 40 ? "…" : ""}`;
      res.locals.snippet = feedback.slice(0, 140);
      res.locals.content = feedback;
      res.json({ kind: "term-paper", feedback, generatedAt: new Date().toISOString() });
    } catch (err) {
      const message = err instanceof GroqNotConfiguredError ? err.message : String(err);
      console.error("term-paper research generation failed (payment already settled):", err);
      res.status(502).json({ error: "Research generation failed", detail: message });
    }
  });

  app.post("/paid/research/news", async (req, res) => {
    res.locals.kind = "news";
    const topic = typeof req.body?.topic === "string" ? req.body.topic : undefined;
    if (!topic) {
      res.status(400).json({ error: "Request body must include a `topic` string" });
      return;
    }
    try {
      const analysis = await groqComplete(NEWS_SYSTEM_PROMPT, topic);
      res.locals.headline = topic.charAt(0).toUpperCase() + topic.slice(1);
      res.locals.snippet = analysis.slice(0, 140);
      res.locals.content = analysis;
      res.json({ kind: "news", topic, analysis, generatedAt: new Date().toISOString() });
    } catch (err) {
      const message = err instanceof GroqNotConfiguredError ? err.message : String(err);
      console.error("news research generation failed (payment already settled):", err);
      res.status(502).json({ error: "Research generation failed", detail: message });
    }
  });
}

app.listen(port, () => {
  console.log(`Resource server (base "researcher" agent) listening at http://localhost:${port}`);
  console.log(`  landing:   GET /`);
  console.log(`  free:      GET /paid/quote/preview`);
  console.log(`  paid:      GET /paid/quote  (x402-gated, settled via ${process.env.FACILITATOR_URL})`);
  if (process.env.GROQ_API_KEY) {
    console.log(`  paid:      POST /paid/research/term-paper  (x402-gated, Groq-generated)`);
    console.log(`  paid:      POST /paid/research/news        (x402-gated, Groq-generated)`);
  } else {
    console.log(`  research routes NOT mounted — set GROQ_API_KEY and restart to enable them`);
  }
  console.log(`  activity:  GET /activity`);
  console.log(`  dashboard: GET /dashboard`);
});
