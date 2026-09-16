import { storage } from "@/src/utils/storage";

/**
 * On-device billing bookkeeping. This is a cache of what Google Play last told
 * us plus the free-analysis counter — never a proof of payment. Google Play is
 * always the source of truth (see src/billing/store.android.ts).
 */

// Pre-1.1.5 this single key held the counter for the whole DEVICE, which meant the
// first account to spend its free analysis left a floor that every later account
// inherited (and Android auto-backup restored it after a reinstall). The counter is
// now stored per account — `billing_free_analyses_used:<email>` — so each account
// gets the free analysis the backend says it still has. The bare key is only used
// when nobody is signed in (activation-key path).
const USED_KEY = "billing_free_analyses_used";
const usedKeyFor = (account?: string | null) =>
  account ? `${USED_KEY}:${account.trim().toLowerCase()}` : USED_KEY;
const ENTITLEMENT_KEY = "billing_entitlement";
// Set when a subscription Play used to report is no longer active, so the app can say "expired".
const LAPSED_KEY = "billing_lapsed";

interface EntitlementSnapshot {
  productId: string;
  checkedAt: number;
}

export async function readUsedAnalyses(account?: string | null): Promise<number> {
  const raw = await storage.getItem<number>(usedKeyFor(account), 0);
  return typeof raw === "number" && raw > 0 ? raw : 0;
}

export async function recordAnalysisUsed(account?: string | null): Promise<number> {
  const next = (await readUsedAnalyses(account)) + 1;
  await storage.setItem(usedKeyFor(account), next);
  return next;
}

/**
 * Aligns this account's on-device counter with what the backend has logged for the
 * SAME account. It never lowers that account's own count, so an analysis counted
 * while offline is not forgotten — but because the key is per account, a different
 * (or brand new) account always starts from its own server count instead of
 * inheriting whatever the previous account on this phone had spent.
 */
export async function reconcileUsedAnalyses(serverUsed: number, account?: string | null): Promise<number> {
  const local = await readUsedAnalyses(account);
  const merged = Math.max(local, serverUsed);
  if (merged !== local) await storage.setItem(usedKeyFor(account), merged);
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
