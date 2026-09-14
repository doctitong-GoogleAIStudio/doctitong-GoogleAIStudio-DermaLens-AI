import { apiUrl, clearToken, getToken } from "@/src/api";
import { type ClinicalHistory, type Diagnosis } from "@/src/types";

/**
 * AI analysis runs on this app's backend (POST /api/analyze), which holds the
 * Gemini credentials. No AI key or model name ships inside the app bundle.
 */

const ALLOWED_MIMES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const TIMEOUT_MS = 120000;

export interface AnalysisImage {
  base64: string;
  mimeType?: string;
}

function normalizeMime(mime?: string): string {
  const m = (mime ?? "").toLowerCase();
  return ALLOWED_MIMES.includes(m) ? m : "image/jpeg";
}

export async function analyzeImages(
  images: AnalysisImage[],
  extra?: { history?: ClinicalHistory; viewLabels?: string[] },
): Promise<Diagnosis> {
  if (images.length === 0) throw new Error("Please add at least one photo.");

  const token = await getToken();
  if (!token) {
    throw new Error(
      "Please sign out and sign in again while connected to the internet to enable AI analysis.",
    );
  }

  const body = {
    images: images.map((img) => ({
      mimeType: normalizeMime(img.mimeType),
      data: img.base64.replace(/^data:[^,]+,/, ""),
    })),
    ...(extra?.history ? { history: extra.history } : {}),
    ...(extra?.viewLabels ? { viewLabels: extra.viewLabels } : {}),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(apiUrl("/api/analyze"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error("The analysis took too long. Please try again.");
    throw new Error("No internet connection. AI analysis needs to be online — your photos stay on this phone.");
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    const detail = typeof payload?.detail === "string" ? payload.detail : "";
    if (res.status === 401) {
      await clearToken();
      throw new Error("Your session expired. Please sign out and sign in again to continue.");
    }
    throw new Error(detail || `AI analysis failed (${res.status}). Please try again.`);
  }

  const parsed = await res.json().catch(() => null);
  if (!parsed?.mostLikelyDiagnosis) {
    throw new Error("The AI returned an unreadable response. Please try again.");
  }

  return {
    imageQuality: parsed.imageQuality ?? { score: "Fair", feedback: "" },
    assessmentPossible: parsed.assessmentPossible ?? true,
    moreInfoNeeded: parsed.moreInfoNeeded ?? [],
    mostLikelyDiagnosis: parsed.mostLikelyDiagnosis,
    differentialDiagnoses: parsed.differentialDiagnoses ?? [],
    redFlags: parsed.redFlags ?? [],
    nextSteps: parsed.nextSteps ?? [],
    disclaimer:
      parsed.disclaimer ??
      "This is an AI-generated analysis for educational purposes only and is not a substitute for professional medical advice.",
  };
}
