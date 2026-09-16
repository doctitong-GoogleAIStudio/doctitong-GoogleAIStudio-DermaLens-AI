import { storage } from "@/src/utils/storage";

/**
 * On-device billing bookkeeping. This is a cache of what Google Play last told
 * us plus the free-analysis counter — never a proof of payment. Google Play is
 * always the source of truth (see src/billing/store.android.ts).
 */

const USED_KEY = "billing_free_analyses_used";
const ENTITLEMENT_KEY = "billing_entitlement";
// Set when a subscription Play used to report is no longer active, so the app can say "expired".
const LAPSED_KEY = "billing_lapsed";

interface EntitlementSnapshot {
  productId: string;
  checkedAt: number;
}

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

export async function readEntitlement(): Promise<EntitlementSnapshot | null> {
  const raw = await storage.getItem<string>(ENTITLEMENT_KEY, "");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as EntitlementSnapshot;
  } catch {
    return null;
  }
}

export async function writeEntitlement(productId: string): Promise<void> {
  const snapshot: EntitlementSnapshot = { productId, checkedAt: Date.now() };
  await storage.setItem(ENTITLEMENT_KEY, JSON.stringify(snapshot));
}

export async function clearEntitlement(): Promise<void> {
  await storage.removeItem(ENTITLEMENT_KEY);
}

export async function readLapsed(): Promise<boolean> {
  return (await storage.getItem<boolean>(LAPSED_KEY, false)) === true;
}

/** Remembers that a previously granted subscription has ended. */
export async function markLapsed(): Promise<void> {
  await storage.setItem(LAPSED_KEY, true);
}

export async function clearLapsed(): Promise<void> {
  await storage.removeItem(LAPSED_KEY);
}
