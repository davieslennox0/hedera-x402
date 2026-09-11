import { config } from "dotenv";
import { wrapFetchWithPayment, x402HTTPClient } from "@x402/fetch";
import { buildPayingClient } from "../client/pay.js";

config();

const buyerAccountId = process.env.BUYER_ACCOUNT_ID;
const buyerPrivateKey = process.env.BUYER_PRIVATE_KEY;
const baseUrl = process.env.RESOURCE_SERVER_URL ?? "http://localhost:4021";
const paidUrl = `${baseUrl}/paid/quote`;

// Randomized 8-12s delay between requests, so consecutive settlements on
// the dashboard/recording don't land on a suspiciously exact metronome.
const MIN_DELAY_MS = 8000;
const MAX_DELAY_MS = 12000;

if (!buyerAccountId || !buyerPrivateKey) {
  console.error("[buyer-agent] Missing BUYER_ACCOUNT_ID or BUYER_PRIVATE_KEY");
  process.exit(1);
}

const client = buildPayingClient(buyerAccountId, buyerPrivateKey);
const httpClient = new x402HTTPClient(client);
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function jitter(): number {
  return MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
}

async function makeOnePayment(): Promise<void> {
  const res = await fetchWithPayment(paidUrl, { method: "GET" });
  const result = await httpClient.processResponse(res);

  if (result.header && "success" in result.header && result.header.success) {
    console.log(
      `[buyer-agent] settled tx=${result.header.transaction} ` +
        `https://hashscan.io/testnet/transaction/${result.header.transaction}`,
    );
  } else {
    console.log(`[buyer-agent] request did not settle (status=${result.status})`, result.header);
  }
}

async function main(): Promise<void> {
  console.log(`[buyer-agent] starting, buyer=${buyerAccountId}, target=${paidUrl}`);
  // Runs forever under pm2; each iteration is a real, independent Hedera
  // testnet payment — no mocking, no shared/replayed transaction.
  for (;;) {
    try {
      await makeOnePayment();
    } catch (err) {
      console.error("[buyer-agent] payment attempt failed:", err);
    }
    await delay(jitter());
  }
}

main();
