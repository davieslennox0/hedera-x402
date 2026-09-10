import { PrivateKey } from "@x402/hedera";

/**
 * Generates a Hedera ECDSA keypair offline (no network call). Hedera doesn't
 * assign a real 0.0.x account id until the account is actually created
 * on-ledger — for a freshly generated key that hasn't happened yet, so what
 * we print here is the key's EVM-style alias address. That alias can receive
 * HBAR immediately (from the testnet faucet or any transfer); Hedera
 * auto-creates the real account on first credit and you look up its 0.0.x
 * id afterwards via the mirror node.
 */
function generate(label: string) {
  const key = PrivateKey.generateECDSA();
  const alias = key.publicKey.toEvmAddress();
  console.log(`\n--- ${label} ---`);
  console.log(`private key : ${key.toStringDer()}`);
  console.log(`public key  : ${key.publicKey.toStringDer()}`);
  console.log(`alias (fund this at the faucet): 0x${alias}`);
}

generate("SELLER (payTo)");
generate("BUYER (client)");

console.log(
  "\nFund both aliases at https://portal.hedera.com/faucet, then look up each\n" +
    "alias's real 0.0.x account id at:\n" +
    "  https://testnet.mirrornode.hedera.com/api/v1/accounts?account.id=<alias>\n" +
    "(or just the HashScan testnet explorer UI) and fill in .env.",
);
