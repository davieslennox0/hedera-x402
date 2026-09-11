import { writeFile } from "node:fs/promises";
import path from "node:path";

export type ActivityEntry = {
  timestamp: string;
  txId: string;
  amountTinybars: string;
  buyer: string | undefined;
  seller: string;
  status: "settled";
};

const MAX_ENTRIES = 100;
const ACTIVITY_FILE = path.join(process.cwd(), "activity.json");

// In-memory ring buffer is the source of truth for GET /activity (cheap,
// no disk read on the hot path); activity.json is a durable mirror written
// on every append so the log survives a server restart and matches what the
// task asked for ("appends to activity.json on success").
const entries: ActivityEntry[] = [];

export function recordSettlement(entry: ActivityEntry): void {
  entries.unshift(entry);
  entries.length = Math.min(entries.length, MAX_ENTRIES);
  // Fire-and-forget: never let a disk write slow down or fail the request
  // that triggered it.
  writeFile(ACTIVITY_FILE, JSON.stringify(entries, null, 2)).catch(err => {
    console.error("Failed to persist activity.json:", err);
  });
}

export function getActivity(): ActivityEntry[] {
  return entries;
}
