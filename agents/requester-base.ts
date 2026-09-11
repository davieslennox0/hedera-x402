import { config } from "dotenv";
import { wrapFetchWithPayment, x402HTTPClient } from "@x402/fetch";
import { buildPayingClient } from "../client/pay.js";

config();

export type RequesterConfig = {
  label: string;
  endpoint: string;
  buildBody: () => Record<string, unknown>;
  minDelayMs?: number;
  maxDelayMs?: number;
  /**
   * This agent's own dedicated account, e.g. REQUESTER_1_ACCOUNT_ID /
   * REQUESTER_1_PRIVATE_KEY. Falls back to the shared BUYER_ACCOUNT_ID /
   * BUYER_PRIVATE_KEY when either is unset, so an agent still runs (paying
   * from the shared account) before its own burner has been funded.
   */
  accountId?: string;
  privateKey?: string;
};

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Shared loop for a "requester" agent: builds a fresh request body, pays
 * for POST `endpoint` via x402 (same buildPayingClient/spend-controls setup
 * client/index.ts uses), and logs the settlement + the researcher's actual
 * generated deliverable. All three requester-*.ts entry scripts are thin
 * wrappers around this with a different endpoint/body/cadence.
 */
export async function runRequesterLoop(cfg: RequesterConfig): Promise<void> {
  const buyerAccountId = cfg.accountId || process.env.BUYER_ACCOUNT_ID;
  const buyerPrivateKey = cfg.privateKey || process.env.BUYER_PRIVATE_KEY;
  const usingOwnAccount = Boolean(cfg.accountId && cfg.privateKey);
  const baseUrl = process.env.RESOURCE_SERVER_URL ?? "http://localhost:4021";
  const minDelay = cfg.minDelayMs ?? 80000;
  const maxDelay = cfg.maxDelayMs ?? 100000;

  if (!buyerAccountId || !buyerPrivateKey) {
    console.error(`[${cfg.label}] Missing account credentials (own burner or BUYER_ACCOUNT_ID fallback)`);
    process.exit(1);
  }
  if (!usingOwnAccount) {
    console.warn(
      `[${cfg.label}] dedicated account not set/funded yet — falling back to the shared ` +
        `BUYER_ACCOUNT_ID (${buyerAccountId}). Fill in its own account id in .env once funded.`,
    );
  }

  const client = buildPayingClient(buyerAccountId, buyerPrivateKey);
  const httpClient = new x402HTTPClient(client);
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);
  const url = `${baseUrl}${cfg.endpoint}`;

  console.log(`[${cfg.label}] starting, buyer=${buyerAccountId}, target=${url}`);

  for (;;) {
    const body = cfg.buildBody();
    try {
      const res = await fetchWithPayment(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await httpClient.processResponse(res);

      if (result.header && "success" in result.header && result.header.success) {
        console.log(
          `[${cfg.label}] settled tx=${result.header.transaction} ` +
            `https://hashscan.io/testnet/transaction/${result.header.transaction}`,
        );
        const deliverable =
          result.body && typeof result.body === "object"
            ? JSON.stringify(result.body).slice(0, 220)
            : String(result.body).slice(0, 220);
        console.log(`[${cfg.label}] deliverable: ${deliverable}...`);
      } else {
        console.log(
          `[${cfg.label}] request did not settle (status=${result.status})`,
          result.header ?? result.body,
        );
      }
    } catch (err) {
      console.error(`[${cfg.label}] request failed:`, err);
    }
    await delay(minDelay + Math.random() * (maxDelay - minDelay));
  }
}
