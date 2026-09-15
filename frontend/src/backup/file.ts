import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";

/** Native file plumbing for backups. The web build uses file.web.ts. */

const SCANS_DIR = `${FileSystem.documentDirectory}scans/`;

export async function saveAndShare(fileName: string, text: string): Promise<string> {
  const uri = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(uri, text);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: "application/json",
      dialogTitle: "Save your DermaLens backup",
      UTI: "public.json",
    });
  }
  return uri;
}

export async function pickBackupText(): Promise<string | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
  if (res.canceled || !res.assets?.length) return null;
  return FileSystem.readAsStringAsync(res.assets[0].uri);
}

export async function readImageBase64(uri: string): Promise<string | null> {
  try {
    return await FileSystem.readAsStringAsync(uri, { encoding: "base64" });
  } catch {
    return null; // file was deleted from the device
  }
}

export async function writeImageBase64(base64: string, name: string): Promise<string> {
  await FileSystem.makeDirectoryAsync(SCANS_DIR, { intermediates: true }).catch(() => {});
  const uri = `${SCANS_DIR}${name}`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: "base64" });
  return uri;
}
