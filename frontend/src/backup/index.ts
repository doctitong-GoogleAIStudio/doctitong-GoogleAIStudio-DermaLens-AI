import { readHistory, writeHistory } from "@/src/history";
import type { HistoryItem } from "@/src/types";

import { openBackup, sealBackup } from "./crypto";
import { pickBackupText, readImageBase64, saveAndShare, writeImageBase64 } from "./file";

/**
 * Full on-device backup: every scan with its photos, sealed with the user's
 * password into a single file they can keep or move to a new phone.
 */

export interface BackupProgress {
  step: string;
  done: number;
  total: number;
}

type Progress = (p: BackupProgress) => void;

interface BackupPayload {
  items: HistoryItem[]; // image fields hold photo keys, not uris
  photos: Record<string, string>; // key -> base64
}

export interface ExportResult {
  fileName: string;
  scans: number;
  photos: number;
  missingPhotos: number;
}

export async function exportBackup(password: string, onProgress?: Progress): Promise<ExportResult> {
  const items = await readHistory();
  if (items.length === 0) throw new Error("There are no scans to back up yet.");

  const photos: Record<string, string> = {};
  const out: HistoryItem[] = [];
  let missingPhotos = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const keyByUri = new Map<string, string>();

    const collect = async (uri: string): Promise<string | null> => {
      if (!uri) return null;
      const known = keyByUri.get(uri);
      if (known) return known;
      const base64 = await readImageBase64(uri);
      if (!base64) {
        missingPhotos++;
        return null;
      }
      const key = `${item.id}-${keyByUri.size}.jpg`;
      photos[key] = base64;
      keyByUri.set(uri, key);
      return key;
    };

    const images: string[] = [];
    for (const uri of item.images) {
      const key = await collect(uri);
      if (key) images.push(key);
    }
    out.push({ ...item, images, thumbnail: (await collect(item.thumbnail)) ?? images[0] ?? "" });
    onProgress?.({ step: "Collecting photos", done: i + 1, total: items.length });
  }

  onProgress?.({ step: "Encrypting", done: items.length, total: items.length });
  const payload: BackupPayload = { items: out, photos };
  const fileText = await sealBackup(JSON.stringify(payload), password, items.length);

  const fileName = `dermalens-backup-${new Date().toISOString().slice(0, 10)}.json`;
  onProgress?.({ step: "Saving file", done: items.length, total: items.length });
  await saveAndShare(fileName, fileText);

  return { fileName, scans: items.length, photos: Object.keys(photos).length, missingPhotos };
}

export interface ImportResult {
  added: number;
  updated: number;
  scans: number;
}

/** Returns null when the user cancels the file picker. */
export async function importBackup(password: string, onProgress?: Progress): Promise<ImportResult | null> {
  const fileText = await pickBackupText();
  if (!fileText) return null;

  onProgress?.({ step: "Decrypting", done: 0, total: 1 });
  const plaintext = await openBackup(fileText, password);

  let payload: BackupPayload;
  try {
    payload = JSON.parse(plaintext);
  } catch {
    throw new Error("The backup file is damaged.");
  }
  if (!Array.isArray(payload?.items)) throw new Error("The backup file is damaged.");

  const existing = await readHistory();
  const byId = new Map(existing.map((i) => [i.id, i]));
  const uriByKey = new Map<string, string>();
  let added = 0;
  let updated = 0;

  for (let i = 0; i < payload.items.length; i++) {
    const item = payload.items[i];

    const restore = async (key: string): Promise<string | null> => {
      if (!key) return null;
      const cached = uriByKey.get(key);
      if (cached) return cached;
      const base64 = payload.photos?.[key];
      if (!base64) return null;
      const uri = await writeImageBase64(base64, `restored-${key}`);
      uriByKey.set(key, uri);
      return uri;
    };

    const images: string[] = [];
    for (const key of item.images ?? []) {
      const uri = await restore(key);
      if (uri) images.push(uri);
    }
    const restored: HistoryItem = {
      ...item,
      images,
      thumbnail: (await restore(item.thumbnail)) ?? images[0] ?? "",
    };

    if (byId.has(restored.id)) updated++;
    else added++;
    byId.set(restored.id, restored);
    onProgress?.({ step: "Restoring scans", done: i + 1, total: payload.items.length });
  }

  const merged = [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
  await writeHistory(merged);

  return { added, updated, scans: payload.items.length };
}
