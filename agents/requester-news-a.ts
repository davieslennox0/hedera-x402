import { runRequesterLoop } from "./requester-base.js";

const TOPICS = [
  "stablecoin regulation in the EU",
  "on-chain agent-to-agent payments",
  "layer-2 rollup fee markets",
];

let i = 0;
function nextTopic(): string {
  const topic = TOPICS[i % TOPICS.length];
  i += 1;
  return topic;
}

runRequesterLoop({
  label: "requester-news-a",
  endpoint: "/paid/research/news",
  buildBody: () => ({ topic: nextTopic() }),
  minDelayMs: 14000,
  maxDelayMs: 22000,
  accountId: process.env.REQUESTER_2_ACCOUNT_ID,
  privateKey: process.env.REQUESTER_2_PRIVATE_KEY,
});
