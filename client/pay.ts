import { PrivateKey } from "@x402/hedera";
import { createClientHederaSigner } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { x402Client } from "@x402/fetch";

/**
 * Builds an x402Client with the Hedera "exact" scheme registered for a given
 * buyer account. `createClientHederaSigner` (from @x402/hedera) does all the
 * actual transaction work when a payment is needed: builds a TransferTransaction
 * moving `paymentRequirements.amount` of `paymentRequirements.asset` from this
 * account to `payTo`, sets `transactionId.accountId` to the facilitator's
 * `extra.feePayer`, freezes it, signs it with `privateKey`, and returns the
 * base64-encoded partially-signed bytes — the client never talks to
 * Blocky402 or Hedera directly, it only produces that payload.
 */
export function buildPayingClient(buyerAccountId: string, buyerPrivateKey: string): x402Client {
  const signer = createClientHederaSigner(buyerAccountId, PrivateKey.fromString(buyerPrivateKey), {
    network: "hedera:testnet",
  });

  const client = new x402Client().register("hedera:*", new ExactHederaScheme(signer));

  // x402Client's default spend controls only allow "default assets"
  // (findDefaultAsset — for Hedera that's the USDC token id, never HBAR) and
  // reject everything else outright. Since server/index.ts prices in native
  // HBAR (asset "0.0.0"), it has to be explicitly allowlisted here, with an
  // atomic per-payment cap as a sanity ceiling rather than trusting the
  // server's price unconditionally.
  client.setSpendControls({
    allowedAssets: [
      {
        network: "hedera:testnet",
        asset: "0.0.0",
        maxAmountPerPayment: "10000000", // 0.1 HBAR ceiling, in tinybars
      },
    ],
  });

  return client;
}
