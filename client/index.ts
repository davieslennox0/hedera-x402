import { config } from "dotenv";
import { wrapFetchWithPayment, x402HTTPClient } from "@x402/fetch";
import { buildPayingClient } from "./pay.js";

config();

const buyerAccountId = process.env.BUYER_ACCOUNT_ID;
const buyerPrivateKey = process.env.BUYER_PRIVATE_KEY;
const baseUrl = process.env.RESOURCE_SERVER_URL ?? "http://localhost:4021";

if (!buyerAccountId || !buyerPrivateKey) {
  console.error("Missing required BUYER_ACCOUNT_ID or BUYER_PRIVATE_KEY environment variable");
  process.exit(1);
}

async function main(): Promise<void> {
  const freeUrl = `${baseUrl}/paid/quote/preview`;
  const paidUrl = `${baseUrl}/paid/quote`;

  console.log(`\n1. Unpaid request: GET ${freeUrl}`);
  const preview = await fetch(freeUrl);
  console.log(`   -> ${preview.status}`, await preview.json());

  console.log(`\n2. Unpaid request to gated route: GET ${paidUrl}`);
  const unpaid = await fetch(paidUrl);
  console.log(`   -> ${unpaid.status} (expect 402)`);
  console.dir(await unpaid.json(), { depth: null });

  console.log(`\n3. Paying and retrying: GET ${paidUrl}`);
  const client = buildPayingClient(buyerAccountId!, buyerPrivateKey!);
  const httpClient = new x402HTTPClient(client);
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  const paid = await fetchWithPayment(paidUrl, { method: "GET" });
  const result = await httpClient.processResponse(paid);

  console.log(`   -> ${result.status}, paymentStatus=${result.paymentStatus}`);
  console.dir(result.body, { depth: null });

  if (result.header && "success" in result.header && result.header.success) {
    const settlement = result.header;
    console.log(`\nSettled on Hedera testnet:`);
    console.log(`   transactionId: ${settlement.transaction}`);
    console.log(`   payer:         ${settlement.payer}`);
    console.log(
      `   HashScan:      https://hashscan.io/testnet/transaction/${settlement.transaction}`,
    );
  } else {
    console.log(`\nNo successful settlement in response header:`, result.header);
  }
}

main().catch(error => {
  console.error(error?.response?.data?.error ?? error);
  process.exit(1);
});
