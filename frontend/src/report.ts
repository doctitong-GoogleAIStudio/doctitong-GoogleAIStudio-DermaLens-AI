import { Platform } from "react-native";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";

import type { HistoryItem } from "@/src/types";
import { HISTORY_FIELDS } from "@/src/types";
import { informationUsed } from "@/src/informationUsed";

async function imageToDataUri(uri: string): Promise<string | null> {
  try {
    if (uri.startsWith("data:")) return uri;
    const b64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" as any });
    return `data:image/jpeg;base64,${b64}`;
  } catch {
    return null;
  }
}

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function urgencyColor(urgency: string): string {
  const u = urgency.toLowerCase();
  if (u.includes("urgent")) return "#B83A4B";
  if (u.includes("prompt")) return "#A67C00";
  return "#287D4D";
}

export async function buildReportHtml(item: HistoryItem): Promise<string> {
  const d = item.diagnosis;
  const dataUris = (await Promise.all(item.images.slice(0, 4).map(imageToDataUri))).filter(Boolean) as string[];
  const imgHtml = dataUris
    .map((u) => `<img src="${u}" style="width:150px;height:150px;object-fit:cover;border-radius:10px;margin:0 8px 8px 0;border:1px solid #E3EBE7"/>`)
    .join("");

  const diffs = (d.differentialDiagnoses || [])
    .map(
      (x) =>
        `<div class="card"><div class="b">${esc(x.conditionName)}</div><div class="muted">Confidence: ${esc(x.confidence)}</div><p>${esc(x.description)}</p></div>`,
    )
    .join("");

  const steps = (d.nextSteps || []).map((s) => `<li>${esc(s)}</li>`).join("");
  const flags = (d.redFlags || []).map((s) => `<li>${esc(s)}</li>`).join("");
  const infoLines = informationUsed(item)
    .map((l) => `<li>${esc(l.label)}</li>`)
    .join("");
  const h = item.clinicalHistory ?? {};
  const historyRows = HISTORY_FIELDS.filter((f) => (h[f.key] ?? "").trim())
    .map(
      (f) =>
        `<div class="card"><span class="muted">${esc(f.clinicalLabel)}</span><p>${esc((h[f.key] ?? "").trim())}</p></div>`,
    )
    .join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
  <style>
    * { font-family: -apple-system, Helvetica, Arial, sans-serif; color:#111814; }
    body { padding: 28px; }
    h1 { font-size: 24px; margin: 0 0 2px; color:#3B6955; }
    h2 { font-size: 16px; margin: 24px 0 8px; }
    .sub { color:#5C7066; font-size: 12px; margin: 0 0 16px; }
    .card { border:1px solid #E3EBE7; border-radius:12px; padding:14px; margin-bottom:10px; }
    .b { font-weight:700; font-size:15px; }
    .muted { color:#5C7066; font-size:12px; }
    .pill { display:inline-block; padding:4px 10px; border-radius:999px; color:#fff; font-size:12px; font-weight:700; }
    .primary { border:2px solid #3B6955; }
    .cond { color:#3B6955; font-size:18px; font-weight:700; margin:4px 0; }
    ul { margin:6px 0; padding-left:18px; }
    li { margin-bottom:6px; }
    .disc { background:#FFF7E0; border-left:4px solid #A67C00; padding:12px; border-radius:8px; color:#6b5300; font-size:12px; }
  </style></head><body>
    <h1>DermaLens AI</h1>
    <div class="sub">AI-Powered Skin Lesion Analysis &middot; ${esc(item.date)}</div>
    <div>${imgHtml}</div>
    <div class="card"><span class="muted">Image quality</span><div class="b">${esc(d.imageQuality?.score || "")}</div><p class="muted">${esc(d.imageQuality?.feedback || "")}</p></div>
    <h2>Most Likely Diagnosis</h2>
    <div class="card primary">
      <div class="cond">${esc(d.mostLikelyDiagnosis?.conditionName || "")}</div>
      <div class="muted">Confidence: ${esc(d.mostLikelyDiagnosis?.confidence || "")}</div>
      <p>${esc(d.mostLikelyDiagnosis?.description || "")}</p>
      <span class="pill" style="background:${urgencyColor(d.mostLikelyDiagnosis?.urgency || "")}">${esc(d.mostLikelyDiagnosis?.urgency || "")}</span>
      <p class="muted">${esc(d.mostLikelyDiagnosis?.urgencyReason || "")}</p>
    </div>
    ${diffs ? `<h2>Other Possibilities</h2>${diffs}` : ""}
    ${flags ? `<h2>Red Flags</h2><ul>${flags}</ul>` : ""}
    ${steps ? `<h2>Recommended Next Steps</h2><ul>${steps}</ul>` : ""}
    <h2>Information Used</h2><ul>${infoLines}</ul>
    ${historyRows ? `<h2>Clinical History Provided</h2>${historyRows}` : ""}
    ${item.note ? `<h2>Patient Note</h2><div class="card"><p>${esc(item.note)}</p></div>` : ""}
    <h2>Disclaimer</h2>
    <div class="disc">${esc(d.disclaimer || "")}</div>
  </body></html>`;
}

function reportFilename(item: HistoryItem): string {
  const cond = (item.diagnosis?.mostLikelyDiagnosis?.conditionName || "Report").replace(/[^A-Za-z0-9]+/g, "-");
  const date = item.date.replace(/[^A-Za-z0-9]+/g, "-");
  return `DermaLens-${cond}-${date}.pdf`;
}

export async function shareReport(item: HistoryItem): Promise<void> {
  const html = await buildReportHtml(item);
  const filename = reportFilename(item);

  // Native builds print the PDF locally — no server involved. On web the print
  // dialog is the only option available in the browser sandbox.
  if (Platform.OS === "web") {
    await Print.printAsync({ html });
    return;
  }

  const { uri } = await Print.printToFileAsync({ html });
  let shareUri = uri;
  // Give the shared file a meaningful name instead of the random print temp name.
  if (FileSystem.cacheDirectory) {
    try {
      const dest = `${FileSystem.cacheDirectory}${filename}`;
      await FileSystem.copyAsync({ from: uri, to: dest });
      shareUri = dest;
    } catch {}
  }
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(shareUri, {
      mimeType: "application/pdf",
      dialogTitle: "Share Analysis Report",
      UTI: "com.adobe.pdf",
    });
    return;
  }
  await Print.printAsync({ uri: shareUri });
}
