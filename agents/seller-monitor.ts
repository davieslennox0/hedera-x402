import { config } from "dotenv";

config();

const baseUrl = process.env.RESOURCE_SERVER_URL ?? "http://localhost:4021";
const POLL_MS = 4000;

/**
 * Read-only second "agent" for the demo: no keys, no signing, just watches
 * GET /activity (the same endpoint the dashboard polls) and logs a running
 * revenue/count summary. Doesn't transact itself — see README for why this
 * repo ships one real paying agent plus one observer rather than two paying
 * agents (a second funded buyer account wasn't available).
 */

type ActivityEntry = {
  timestamp: string;
  txId: string;
  amountTinybars: string;
  buyer: string | undefined;
  seller: string;
  status: "settled";
};

let lastSeenCount = 0;

function tinybarsToHbar(tinybars: bigint): string {
  return (Number(tinybars) / 1e8).toFixed(4);
}

async function poll(): Promise<void> {
  const res = await fetch(`${baseUrl}/activity`, { cache: "no-store" });
  const entries = (await res.json()) as ActivityEntry[];

  if (entries.length !== lastSeenCount) {
    const total = entries.reduce((sum, e) => {
      const amt = e.amountTinybars === "unknown" ? 0n : BigInt(e.amountTinybars);
      return sum + amt;
    }, 0n);
    console.log(
      `[seller-monitor] ${entries.length} settled payment(s), ` +
        `total revenue ${tinybarsToHbar(total)} HBAR` +
        (entries[0] ? `, most recent tx=${entries[0].txId}` : ""),
    );
    lastSeenCount = entries.length;
  }
}

async function main(): Promise<void> {
  console.log(`[seller-monitor] watching ${baseUrl}/activity every ${POLL_MS}ms`);
  for (;;) {
    try {
      await poll();
    } catch (err) {
      console.error("[seller-monitor] poll failed:", err);
    }
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }
}

main();
