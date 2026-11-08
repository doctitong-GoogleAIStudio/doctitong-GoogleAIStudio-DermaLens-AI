import { storage } from "@/src/utils/storage";

/**
 * On-device bookkeeping for the free analysis. The credit balance is NOT kept
 * here: it is money, so the server owns it and the app only ever displays what
 * the server reports. Nothing in this file is proof of payment.
 */

const USED_KEY = "billing_free_analyses_used";

export async function readUsedAnalyses(): Promise<number> {
  const raw = await storage.getItem<number>(USED_KEY, 0);
  return typeof raw === "number" && raw > 0 ? raw : 0;
}

export async function recordAnalysisUsed(): Promise<number> {
  const next = (await readUsedAnalyses()) + 1;
  await storage.setItem(USED_KEY, next);
  return next;
}

/**
 * Raises the on-device counter to what the account has used on the server.
 * Never lowers it: the device count also guards against several accounts
 * sharing one phone to collect several free analyses.
 */
export async function reconcileUsedAnalyses(serverUsed: number): Promise<number> {
  const local = await readUsedAnalyses();
  const merged = Math.max(local, serverUsed);
  if (merged !== local) await storage.setItem(USED_KEY, merged);
  return merged;
}
