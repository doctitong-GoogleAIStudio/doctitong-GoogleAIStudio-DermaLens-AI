import * as DocumentPicker from "expo-document-picker";

/** Web build of the backup file plumbing (no native file system). */

export async function saveAndShare(fileName: string, text: string): Promise<string> {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return fileName;
}

export async function pickBackupText(): Promise<string | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: false });
  if (res.canceled || !res.assets?.length) return null;
  const asset = res.assets[0];
  if (asset.file) return asset.file.text();
  const resp = await fetch(asset.uri);
  return resp.text();
}

export async function readImageBase64(uri: string): Promise<string | null> {
  try {
    const resp = await fetch(uri);
    const blob = await resp.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = String(reader.result ?? "");
        resolve(result.includes(",") ? result.split(",")[1] : null);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function writeImageBase64(base64: string, name: string): Promise<string> {
  // No file system on web — keep the photo inline so it still renders.
  const mime = name.endsWith(".png") ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${base64}`;
}
