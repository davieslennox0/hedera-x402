import { config } from "dotenv";
import { AccountId, Client, Hbar, PrivateKey, TransferTransaction } from "@x402/hedera";

config();

/**
 * Keeps the demo self-sustaining without repeated faucet trips: the seller
 * (treasury) account naturally accumulates HBAR from every settled x402
 * payment, while the requester accounts drain. This periodically checks
 * each requester's real on-chain balance (mirror node) and, if it's running
 * low, sends a real signed TransferTransaction from the treasury back to
 * it — same Hedera testnet, same public ledger, just not an x402 payment
 * (no facilitator involved; the treasury signs and pays its own network fee
 * directly, like any ordinary Hedera transfer).
 *
 * This is NOT part of the x402 settlement flow and is deliberately kept out
 * of activity.json / the dashboard's "settled payments" count — those are
 * specifically x402 protocol settlements. Rotation events are their own,
 * separate, equally-real on-chain transactions, just logged to stdout here
 * (verifiable independently on HashScan like anything else).
 */

const MIRROR_NODE_URL = "https://testnet.mirrornode.hedera.com";

const sellerAccountId = process.env.SELLER_ACCOUNT_ID;
const sellerPrivateKey = process.env.SELLER_PRIVATE_KEY;
const lowBalanceTinybars = BigInt(process.env.TREASURY_LOW_BALANCE_TINYBARS ?? "200000000");
const topupTinybars = BigInt(process.env.TREASURY_TOPUP_TINYBARS ?? "500000000");
const reserveTinybars = BigInt(process.env.TREASURY_RESERVE_TINYBARS ?? "300000000");
const checkIntervalMs = Number(process.env.TREASURY_CHECK_INTERVAL_MS ?? 120000);

if (!sellerAccountId || !sellerPrivateKey) {
  console.error("[treasury-rotator] Missing SELLER_ACCOUNT_ID or SELLER_PRIVATE_KEY");
  process.exit(1);
}

// Every account in the rotation pool that isn't the treasury itself. Only
// entries that are actually set (funded burners) are included — an unset
// var is skipped rather than treated as a real account.
const pool = [
  { label: "buyer (shared/legacy)", accountId: process.env.BUYER_ACCOUNT_ID },
  { label: "requester-1 (term-paper)", accountId: process.env.REQUESTER_1_ACCOUNT_ID },
  { label: "requester-2 (news-a)", accountId: process.env.REQUESTER_2_ACCOUNT_ID },
  { label: "requester-3 (news-b)", accountId: process.env.REQUESTER_3_ACCOUNT_ID },
].filter((entry): entry is { label: string; accountId: string } => Boolean(entry.accountId));

async function getBalanceTinybars(accountId: string): Promise<bigint> {
  const res = await fetch(`${MIRROR_NODE_URL}/api/v1/accounts/${accountId}`);
  if (!res.ok) {
    throw new Error(`mirror node lookup failed for ${accountId}: ${res.status}`);
  }
  const data = (await res.json()) as { balance: { balance: number } };
  return BigInt(data.balance.balance);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function checkAndTopUp(client: Client): Promise<void> {
  let treasuryBalance = await getBalanceTinybars(sellerAccountId!);

  for (const { label, accountId } of pool) {
    let balance: bigint;
    try {
      balance = await getBalanceTinybars(accountId);
    } catch (err) {
      console.error(`[treasury-rotator] balance check failed for ${label} (${accountId}):`, err);
      continue;
    }

    if (balance >= lowBalanceTinybars) {
      continue;
    }
    if (treasuryBalance - topupTinybars < reserveTinybars) {
      console.warn(
        `[treasury-rotator] ${label} (${accountId}) is low (${balance} tinybars) but treasury ` +
          `reserve would be breached by a top-up — treasury balance ${treasuryBalance}, ` +
          `reserve floor ${reserveTinybars}. Skipping until the treasury has more (fund via faucet).`,
      );
      continue;
    }

    console.log(
      `[treasury-rotator] ${label} (${accountId}) low: ${balance} tinybars. ` +
        `Sending ${topupTinybars} tinybars from treasury ${sellerAccountId}...`,
    );
    try {
      const tx = await new TransferTransaction()
        .addHbarTransfer(AccountId.fromString(sellerAccountId!), Hbar.fromTinybars((-topupTinybars).toString()))
        .addHbarTransfer(AccountId.fromString(accountId), Hbar.fromTinybars(topupTinybars.toString()))
        .execute(client);
      const receipt = await tx.getReceipt(client);
      console.log(
        `[treasury-rotator] top-up settled: tx=${tx.transactionId.toString()} status=${receipt.status.toString()} ` +
          `https://hashscan.io/testnet/transaction/${tx.transactionId.toString()}`,
      );
      treasuryBalance -= topupTinybars;
    } catch (err) {
      console.error(`[treasury-rotator] top-up transfer to ${label} failed:`, err);
    }
  }
}

async function main(): Promise<void> {
  console.log(
    `[treasury-rotator] starting — treasury=${sellerAccountId}, pool=[${pool.map(p => p.label).join(", ")}], ` +
      `checking every ${checkIntervalMs}ms (low<${lowBalanceTinybars}, topup=${topupTinybars}, reserve=${reserveTinybars})`,
  );

  if (pool.length === 0) {
    console.warn("[treasury-rotator] no requester accounts configured — nothing to rotate to. Exiting.");
    return;
  }

  const client = Client.forTestnet().setOperator(
    AccountId.fromString(sellerAccountId!),
    PrivateKey.fromString(sellerPrivateKey!),
  );

  for (;;) {
    try {
      await checkAndTopUp(client);
    } catch (err) {
      console.error("[treasury-rotator] check cycle failed:", err);
    }
    await delay(checkIntervalMs);
  }
}

main();
