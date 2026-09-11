import { runRequesterLoop } from "./requester-base.js";

const TOPICS = [
  "Hedera hashgraph consensus vs. traditional blockchain finality",
  "x402 as an emerging machine-payments standard",
  "AI agent identity and reputation on-chain",
];

let i = 0;
function nextTopic(): string {
  const topic = TOPICS[i % TOPICS.length];
  i += 1;
  return topic;
}

runRequesterLoop({
  label: "requester-news-b",
  endpoint: "/paid/research/news",
  buildBody: () => ({ topic: nextTopic() }),
  minDelayMs: 16000,
  maxDelayMs: 26000,
  accountId: process.env.REQUESTER_3_ACCOUNT_ID,
  privateKey: process.env.REQUESTER_3_PRIVATE_KEY,
});
