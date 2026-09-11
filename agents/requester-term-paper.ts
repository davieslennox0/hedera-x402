import { runRequesterLoop } from "./requester-base.js";

// Rotating sample excerpts — a real integration would take these from an
// actual student submission; for this demo it's a fixed small pool so the
// researcher's Groq output is comparable run to run.
const EXCERPTS = [
  "This paper argues that social media platforms bear primary responsibility for the " +
    "spread of misinformation. However, the analysis relies mostly on anecdotal examples " +
    "from 2020-2021 and does not engage with platform moderation policy changes since then.",
  "The proposed model assumes constant marginal utility across all income brackets, which " +
    "simplifies the math but sidesteps the paper's own stated goal of explaining inequality " +
    "in consumption patterns. No sensitivity analysis is offered for this assumption.",
  "Our results (n=42) suggest a correlation between sleep duration and self-reported focus, " +
    "though the sample was drawn entirely from one university's psychology subject pool, " +
    "which the discussion section does not flag as a limitation on generalizability.",
];

let i = 0;
function nextExcerpt(): string {
  const excerpt = EXCERPTS[i % EXCERPTS.length];
  i += 1;
  return excerpt;
}

runRequesterLoop({
  label: "requester-term-paper",
  endpoint: "/paid/research/term-paper",
  buildBody: () => ({ text: nextExcerpt() }),
  accountId: process.env.REQUESTER_1_ACCOUNT_ID,
  privateKey: process.env.REQUESTER_1_PRIVATE_KEY,
});
