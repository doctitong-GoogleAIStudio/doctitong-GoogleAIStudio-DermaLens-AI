import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";

import { writeHistory } from "@/src/history";
import { queryClient } from "@/src/query-client";
import { clearToken } from "@/src/api";

/**
 * Removes everything on this phone that belongs to the person: scan history,
 * photos, notes, sign-in token and cached queries. Billing bookkeeping is left
 * alone on purpose — the free-analysis counter and the Play entitlement cache
 * are per device (Google Play, not the account, owns the subscription).
 */
export async function clearUserData(): Promise<void> {
  await writeHistory([]);
  await deleteScanPhotos();
  await clearToken();
  queryClient.clear();
}

async function deleteScanPhotos(): Promise<void> {
  if (Platform.OS === "web" || !FileSystem.documentDirectory) return;
  const dir = `${FileSystem.documentDirectory}scans/`;
  try {
    const info = await FileSystem.getInfoAsync(dir);
    if (info.exists) await FileSystem.deleteAsync(dir, { idempotent: true });
  } catch {
    // Best effort — a photo that cannot be removed now disappears with the app data.
  }
  if (FileSystem.cacheDirectory) {
    // Shared PDF reports are copied here under a predictable name.
    try {
      const files = await FileSystem.readDirectoryAsync(FileSystem.cacheDirectory);
      await Promise.all(
        files
          .filter((f) => f.toLowerCase().endsWith(".pdf"))
          .map((f) => FileSystem.deleteAsync(`${FileSystem.cacheDirectory}${f}`, { idempotent: true }).catch(() => {})),
      );
    } catch {}
  }
}
