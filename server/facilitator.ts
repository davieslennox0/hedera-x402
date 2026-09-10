import { config } from "dotenv";
import { x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactHederaScheme } from "@x402/hedera/exact/server";

// This module reads FACILITATOR_URL at top level, and ESM evaluates a
// module's imports (this file) before running the importer's own body — so
// index.ts's `config()` call would run too late to have populated
// process.env by the time this file's top-level code executes. Load env
// here directly instead of relying on import order.
config();

const facilitatorUrl = process.env.FACILITATOR_URL;
if (!facilitatorUrl) {
  throw new Error("FACILITATOR_URL environment variable is required");
}

/**
 * Blocky402's testnet facilitator. `HTTPFacilitatorClient` is what actually
 * makes the /supported, /verify and /settle calls on our behalf — the
 * `paymentMiddleware` in server/index.ts drives it per-request. We don't call
 * those endpoints by hand; the resource-server SDK owns that HTTP round trip
 * so verification stays in lockstep with whatever `@x402/hedera` expects.
 */
export const facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl });

/**
 * Registers the Hedera "exact" scheme against every `hedera:*` network the
 * facilitator advertises. No `defaultAssets` override is configured — we
 * price the gated route directly in HBAR tinybars via an explicit
 * `{ amount, asset: "0.0.0" }` price (see server/index.ts), so the
 * server-side Money→HTS-token conversion path here never runs.
 */
export const resourceServer = new x402ResourceServer(facilitatorClient).register(
  "hedera:*",
  new ExactHederaScheme(),
);
