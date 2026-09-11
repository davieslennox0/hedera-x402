import { chromium } from "playwright";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT, "output");
const RAW_DIR = path.join(OUTPUT_DIR, "_raw");
const DASHBOARD_URL = process.env.DASHBOARD_URL ?? "http://localhost:4021/dashboard/";
const RECORD_SECONDS = Number(process.env.RECORD_SECONDS ?? 75);
// System ffmpeg, not Playwright's bundled one — Playwright's copy is built
// with `--disable-everything` and only enables what its own trace/video
// tooling needs (vp8 encode, webm mux, mjpeg/png/matroska demux). It has no
// libx264 encoder and no mp4 muxer, so `-c:v libx264 ... demo.mp4` fails
// against it with "Unrecognized option 'movflags'". Requires `apt-get
// install ffmpeg` on the host (already done on this box).
const FFMPEG = "ffmpeg";

/**
 * Records real Chromium rendering the live dashboard for RECORD_SECONDS
 * while the pm2 agents (hedera-buyer-agent, hedera-seller-monitor) make
 * real Hedera testnet payments in the background. Uses Playwright's own
 * recordVideo (a real screen capture of the rendered page, not a mock/
 * screenshot slideshow) and its bundled ffmpeg to convert the resulting
 * .webm to .mp4.
 *
 * Assumes: the resource server is already running (npm run server) and
 * the pm2 agents are already started (pm2 start ecosystem.config.cjs) —
 * this script only drives the browser, it doesn't start either.
 */
async function main() {
  await mkdir(RAW_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: RAW_DIR, size: { width: 1280, height: 800 } },
  });

  const page = await context.newPage();
  console.log(`[record-demo] navigating to ${DASHBOARD_URL}`);
  await page.goto(DASHBOARD_URL, { waitUntil: "networkidle" });

  console.log(`[record-demo] recording for ${RECORD_SECONDS}s while agents settle real payments`);
  await page.waitForTimeout(RECORD_SECONDS * 1000);

  // Proving on-chain settlement independently of the dashboard's own claim
  // — look up whatever tx is currently on top of the activity list on the
  // mirror node's own web UI (HashScan). Deliberately navigates the SAME
  // page/tab rather than opening a second one: Playwright's `recordVideo`
  // writes one .webm PER PAGE in a context, so a second tab would produce a
  // second, separate video file that a naive "find the .webm in RAW_DIR"
  // step either misses or (as happened on the first run of this script)
  // silently deletes during cleanup. Staying on one page keeps this to
  // exactly one continuous video for the whole capture.
  const latest = await page.evaluate(async () => {
    const res = await fetch("/activity");
    const entries = await res.json();
    return entries[0]?.txId ?? null;
  });

  if (latest) {
    console.log(`[record-demo] navigating to HashScan for latest settled tx: ${latest}`);
    await page.goto(`https://hashscan.io/testnet/transaction/${encodeURIComponent(latest)}`, {
      waitUntil: "load",
      timeout: 30000,
    });
    // HashScan shows a cookie-consent modal on first load that otherwise
    // sits over the transaction detail for the rest of the recording.
    try {
      await page.getByRole("button", { name: /^accept$/i }).click({ timeout: 5000 });
    } catch {
      /* no consent modal shown (already dismissed / different build) */
    }
    await page.waitForTimeout(8000);
  } else {
    console.log("[record-demo] no settled tx yet to look up on HashScan — skipping that segment");
  }

  await context.close();
  await browser.close();

  // Playwright names the video file after an internal id, not something
  // predictable up front — find whatever landed in RAW_DIR. With a single
  // page in the context (see above) there's exactly one.
  const files = await readdir(RAW_DIR);
  const webm = files.find(f => f.endsWith(".webm"));
  if (!webm) {
    throw new Error(`No .webm found in ${RAW_DIR} after recording`);
  }

  const rawWebm = path.join(RAW_DIR, webm);
  const finalWebm = path.join(OUTPUT_DIR, "demo-raw.webm");
  await rename(rawWebm, finalWebm);
  await rm(RAW_DIR, { recursive: true, force: true });

  const finalMp4 = path.join(OUTPUT_DIR, "demo-raw.mp4");
  console.log(`[record-demo] converting ${finalWebm} -> ${finalMp4}`);
  await execFileAsync(FFMPEG, [
    "-y",
    "-i",
    finalWebm,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    finalMp4,
  ]);

  console.log(`[record-demo] done: ${finalMp4}`);
}

main().catch(err => {
  console.error("[record-demo] failed:", err);
  process.exit(1);
});
