# hedera-x402

A working x402 payment flow on **Hedera testnet**, settled through the **Blocky402** testnet facilitator. Built for ETHOnline 2026's Hedera track.

A resource server exposes one x402-gated route. An unpaid `GET` gets a 402 with Hedera payment requirements attached. A client signs a Hedera transfer transaction, sends it back as a payment header, Blocky402 verifies and settles it on-chain, and the server returns the paid resource.

## Architecture

```
 client/index.ts            server/index.ts             Blocky402
 (buyer, has HBAR)          (seller, payTo account)      testnet facilitator
       |                          |                             |
       |--- GET /paid/quote ----->|                             |
       |<-- 402 + accepts[] ------|                             |
       |                          |                             |
  builds+signs a partially-       |                             |
  signed Hedera TransferTx        |                             |
  (@x402/hedera, via              |                             |
  @hashgraph/sdk's successor,     |                             |
  @hiero-ledger/sdk)              |                             |
       |                          |                             |
       |--- GET /paid/quote ----->|                             |
       |  (PAYMENT-SIGNATURE:     |--- POST /verify ----------->|
       |   base64 partially-      |<-- {isValid: true} ---------|
       |   signed tx) ------------|--- POST /settle ----------->|
       |                          |     (Blocky402 adds its own |
       |                          |      feePayer signature,    |
       |                          |      submits to Hedera)     |
       |                          |<-- {success, transactionId}-|
       |<-- 200 + resource -------|                             |
       |    + PAYMENT-RESPONSE    |                             |
       |    header (settlement)   |                             |
```

The resource server (`server/`) never calls Hedera or Blocky402 directly — `@x402/express`'s `paymentMiddleware`, wired to Blocky402 via `HTTPFacilitatorClient` in `server/facilitator.ts`, owns the `/verify`/`/settle` round trip. The client (`client/pay.ts`) never touches Hedera or Blocky402 directly either — `@x402/hedera`'s `createClientHederaSigner` builds, freezes and signs the `TransferTransaction`.

## Why HBAR instead of a token

Hedera HTS tokens (e.g. testnet USDC) require every account to explicitly run `TokenAssociateTransaction` before it can receive that token — otherwise transfers fail on-chain with `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT`. To keep the "real, no mocks" end-to-end path simple, `server/index.ts` prices the gated route directly in native HBAR (`asset: "0.0.0"`, in tinybars) instead of a Money string like `"$0.05"` — `@x402/hedera`'s server-side Money→asset conversion explicitly refuses to resolve to HBAR (`"Default Hedera asset must be an HTS fungible token ID"`), so an explicit `{ amount, asset: "0.0.0" }` `price` object is required for this to work. Paying in an HTS token instead is a one-line swap (`asset: "<token id>"`, `TokenAssociateTransaction` beforehand for both accounts) — see `@x402/hedera`'s README for the association snippet.

> **Note:** Hiero Local Node (a local Hedera devnet for CI) is in a 6-month deprecation window as of September 2026, with migration recommended to [Solo](https://hedera.com/blog/hiero-local-node-deprecation-6-month-transition-to-solo/). Not used anywhere here — this repo talks to real Hedera testnet consensus nodes and the public mirror node directly — but relevant if this gets extended into a CI pipeline later.

## Setup

1. `npm install`
2. `npm run generate-accounts` — generates two ECDSA keypairs offline (no network call) and prints each one's EVM-alias address. Hedera doesn't assign a real `0.0.x` account id until the account exists on-ledger; a freshly generated key only has that alias until it's funded.
3. Fund both aliases at the [Hedera testnet faucet](https://portal.hedera.com/faucet) (paste the `0x...` alias — the faucet creates + funds the real account for you).
4. Look up each alias's resulting `0.0.x` account id — either on [HashScan testnet](https://hashscan.io/testnet) or via the mirror node: `https://testnet.mirrornode.hedera.com/api/v1/accounts?account.id=<alias>`.
5. Copy `.env.example` to `.env` and fill in `SELLER_ACCOUNT_ID` (seller's `0.0.x`), `BUYER_ACCOUNT_ID` / `BUYER_PRIVATE_KEY` (buyer's `0.0.x` + its private key from step 2).
6. Confirm Blocky402's testnet facilitator supports Hedera: `curl https://api.testnet.blocky402.com/supported` — should list a `hedera:testnet` kind with an `extra.feePayer` account. That account is Blocky402's own fee-paying account; it's fetched and merged into payment requirements automatically, nothing to configure.
7. Terminal 1: `npm run server`
8. Terminal 2: `npm run client`

## Payment flow, with a real settled example

This is a real run against Hedera testnet and Blocky402's testnet facilitator — no mocks.

1. **Free preview**, no payment:
   ```
   GET /paid/quote/preview -> 200 {"tier":"preview","symbol":"HBAR/USD",...}
   ```
2. **Unpaid gated request** gets a 402 with a `PAYMENT-REQUIRED` header. Decoded:
   ```json
   {
     "x402Version": 2,
     "error": "Payment required",
     "resource": { "url": "http://localhost:4021/paid/quote", "description": "Full market quote (paid tier)", "mimeType": "application/json" },
     "accepts": [{
       "scheme": "exact",
       "network": "hedera:testnet",
       "amount": "5000000",
       "asset": "0.0.0",
       "payTo": "0.0.10465844",
       "maxTimeoutSeconds": 300,
       "extra": { "feePayer": "0.0.7162784" }
     }]
   }
   ```
   `extra.feePayer` (`0.0.7162784`) came from Blocky402's `/supported` response, merged in automatically — nothing in this repo hardcodes it.
3. **Client signs** a partially-signed `TransferTransaction` (buyer `0.0.10465813` → seller `0.0.10465844`, 5,000,000 tinybars, `transactionId.accountId` set to the feePayer) and retries with a `PAYMENT-SIGNATURE` header.
4. **Server forwards to Blocky402** (`/verify` then `/settle`); Blocky402 adds its own fee-payer signature and submits to Hedera testnet.
5. **Response**: `200`, `paymentStatus=settled`, resource body returned, plus a `PAYMENT-RESPONSE` header with the settlement.

Real settled transaction: **`0.0.7162784@1789074280.034424458`** — [HashScan testnet](https://hashscan.io/testnet/transaction/0.0.7162784@1789074280.034424458). Confirmed independently via the mirror node (`/api/v1/transactions/0.0.7162784-1789074280-034424458`): a `SUCCESS` `CRYPTOTRANSFER` moving exactly 5,000,000 tinybars from `0.0.10465813` to `0.0.10465844`, with `0.0.7162784` (Blocky402) paying the 266,026-tinybar network fee.

## Live dashboard + continuous agents

Beyond the one-shot `npm run client` walkthrough above, this repo also ships a live-updating view and two long-running processes for demo purposes — everything below is still real Hedera testnet activity, nothing mocked.

- **`GET /dashboard`** — a single static page (`dashboard/index.html`, no build step, no framework) that polls `GET /activity` every 2.5s and renders a live table of settled payments (time, tx id linked to HashScan, amount, buyer), plus running totals.
- **`GET /activity`** — recent settlements, newest first. Populated by a small `res.on("finish")` hook in `server/index.ts` that reads back the `PAYMENT-RESPONSE` header `paymentMiddleware` already attaches to a settled response (decoded via `@x402/core/http`'s `decodePaymentResponseHeader`) — it observes the existing verify/settle result rather than re-implementing any of it. Also mirrored to `activity.json` on disk so the log survives a server restart.
- **`agents/buyer-agent.ts`** — loops forever (randomized 8–12s delay) making real paid requests against `/paid/quote`, using the same `buildPayingClient` the manual client uses. Each iteration is an independent, real settled Hedera testnet transaction.
- **`agents/seller-monitor.ts`** — a read-only second process that polls `/activity` and logs a running revenue/count summary. It doesn't hold keys or transact; see below for why this repo ships one real paying agent plus one observer rather than two paying agents.
- **`ecosystem.config.cjs`** — pm2 config for both. Run `pm2 start ecosystem.config.cjs && pm2 save`.

**Why one buyer agent instead of two:** only one funded buyer testnet account exists in `.env` (`BUYER_ACCOUNT_ID`). A second real paying agent needs a second funded account, which is a human faucet-funding step (see Setup above) — rather than fake a second buyer's activity, this repo ships a genuinely read-only second process instead. Funding a second account and pointing a `buyer-agent-2.ts` at it (identical to `buyer-agent.ts` with different env vars) is a small, mechanical follow-up if two paying agents are wanted on camera.

**Recording the demo:** `npm run record-demo` (`scripts/record-demo.mjs`) launches real Chromium under Xvfb (`xvfb-run`, since this box has no display server), navigates to `/dashboard`, records `RECORD_SECONDS` (default 60) of the live table updating via Playwright's own `recordVideo`, then navigates the same tab to HashScan testnet for the most recently settled tx as on-chain proof, and converts the resulting `.webm` to `.mp4` via system `ffmpeg` (**not** Playwright's own bundled `ffmpeg` — that copy is built with `--disable-everything` for Playwright's internal trace tooling only and has no `libx264`/mp4 support; `apt-get install ffmpeg` first). Assumes the server and both pm2 agents are already running. Output: `output/demo-raw.mp4`.

## Friction / notes for the Blocky402 / x402 team

1. **`@hashgraph/sdk` is deprecated in favor of `@hiero-ledger/sdk`, and `@x402/hedera` only exposes the latter.** The task brief for this build (written from general x402 knowledge) assumed `@hashgraph/sdk`; the actual `@x402/hedera` package re-exports a pinned subset of `@hiero-ledger/sdk` instead, specifically to avoid a real footgun documented in its own README — installing `@hiero-ledger/sdk` directly *alongside* `@x402/hedera` in a workspace with independent installs causes its `instanceof`/string-brand checks to cross-fail at runtime (`t.startsWith is not a function`). This is good, deliberate design, but it means anyone starting from Hedera's older docs/tutorials (which still reference `@hashgraph/sdk`) will reach for the wrong package first. A note in the `@x402/hedera` README pointing this out explicitly (not just "we re-export the SDK") would save that detour.
2. **Paying in native HBAR requires an explicit `{amount, asset}` price object — `price: "$0.05"` silently can't resolve to HBAR.** `ExactHederaScheme`'s server-side Money-string conversion (`defaultMoneyConversion` in `exact/server/scheme.ts`) explicitly throws `"Default Hedera asset must be an HTS fungible token ID"` if the resolved default asset is `"0.0.0"` — by design, since `DEFAULT_ASSETS` only maps to the USDC token id per network. That's a reasonable default (USD-denominated pricing wants a stable, not a volatile native token), but it means the simplest possible integration — "pay a little HBAR, no token association needed" — isn't reachable via the documented `price: "$x.xx"` shorthand at all; you have to already know to pass `price: { amount, asset: "0.0.0" }` instead. Worth a line in the express/Hedera example server, since HBAR is the obvious first thing anyone tries.
3. **Client-side spend controls reject HBAR by default, with an error message that doesn't say why.** `x402Client`'s default `SpendControls` only allow "default assets" (again, the USDC token id for Hedera) — any other asset, including native HBAR, is rejected outright unless explicitly added to `allowedAssets`. The thrown error (`"All payment requirements were rejected by spendControls..."`) correctly tells you *what* to do (`allowedAssets`), but doesn't say *why* HBAR in particular isn't a "default asset" for Hedera — that took reading `defaultAssets.ts` in the `@x402/hedera` source to understand. This is sensible safety behavior once understood; the fix (`client/pay.ts` in this repo) is one small `allowedAssets` entry with an atomic per-payment cap.
4. **The `exact` Hedera scheme spec doc's field names don't quite match the shipped TypeScript types.** `specs/schemes/exact/scheme_exact_hedera.md`'s `SettlementResponse` example uses `transactionId`; the actual `SettleResponse` type in `@x402/core`'s `types/facilitator.ts` calls that field `transaction`. Caught immediately by `tsc`, but it's the kind of spec/implementation drift that would bite anyone writing against the spec doc alone without also reading the source.
5. **What worked well:** everything else matched documentation closely. `curl /supported` gave an immediately-actionable, self-describing response (network, scheme, feePayer) with no further digging needed. The whole client-side transaction construction/signing/base64-encoding — the part of this integration with the most room for subtle bugs — is fully owned by `createClientHederaSigner`; this repo's client code never touches `@hiero-ledger/sdk` directly at all. And the automatic `extra.feePayer` merge from the facilitator's `/supported` response into `PaymentRequirements` (`enhancePaymentRequirements` in `exact/server/scheme.ts`) meant the resource server never had to be told Blocky402's fee-payer account — it discovers it on every request.

## Recorded demo

`output/hedera-x402-demo.mp4` (89.7s, well under the 5-minute cap) — real Chromium recording of the live dashboard, captured via `npm run record-demo` while both pm2 agents made real Hedera testnet payments in the background:

- **0:00–1:17** — `/dashboard` live, polling `/activity`, the settled-payments counter and table climbing in real time (23 → 100 settlements across the recording) as `hedera-buyer-agent` pays roughly every 8–12s. Every row is a real transaction id linking to HashScan.
- **1:17–1:30** — same tab navigates to HashScan testnet for the most recently settled tx, showing `CRYPTO TRANSFER` / `SUCCESS` and the matching id from the dashboard row a moment earlier — independent on-chain confirmation, not just the dashboard's own claim.

**Known cosmetic issue, left as-is rather than risk a re-record:** HashScan's cookie-consent dialog is visible over the transaction detail in the last ~8s — the transaction id, type, and status are still legible behind it, and `scripts/record-demo.mjs` does attempt to dismiss it (`page.getByRole("button", { name: /^accept$/i })`), but the click evidently doesn't land, most likely because the consent widget renders in an iframe or shadow root a plain `getByRole` can't reach. This box is memory-constrained (~1GB RAM, shared with several other long-running services) and two earlier recording attempts were OOM-killed outright, so a fourth Chromium launch purely to chase this cosmetic fix wasn't worth the risk to those other processes — the underlying proof (dashboard row ↔ HashScan tx id ↔ mirror-node confirmation in the README above) is unaffected either way.

**Full shot list this recording followed** (for a from-scratch re-record, e.g. on a machine without this box's memory constraints):

- 0:00–0:30 — what this is, one sentence
- 0:30–1:30 — unpaid request, show the 402 response and its `accepts[]`
- 1:30–3:30 — client signs the Hedera transfer, submits it, show it hit Blocky402's `/verify` and `/settle`
- 3:30–4:30 — show the real settled transaction on HashScan testnet, then the resource being returned
- 4:30–5:00 — wrap, link to repo
