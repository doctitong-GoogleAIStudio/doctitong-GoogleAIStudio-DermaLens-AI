import { HISTORY_FIELDS, type ClinicalHistory, type Diagnosis } from "@/src/types";

/**
 * Talks to the Google Gemini API directly from the device — the app needs no
 * server of its own. Only the AI call itself requires an internet connection.
 */

const API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? "";
const MODEL = process.env.EXPO_PUBLIC_GEMINI_MODEL ?? "gemini-3.1-pro-preview";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const SYSTEM_INSTRUCTION = `You are an expert AI dermatologist assisting with preliminary, educational visual analysis of skin lesion photographs. You never claim certainty and always include a medical disclaimer.

First, assess the quality of the provided image(s) for clinical analysis. Rate quality as 'Excellent', 'Good', 'Fair', or 'Poor' based on lighting, focus/clarity and framing, with brief feedback. Then analyze the morphology of the lesion(s) (color, shape, border, size, texture) and identify key features based ONLY on the information supplied to you.

If the supplied information is genuinely insufficient for a useful assessment (for example a severely blurred, dark or overexposed photograph, or a view too distant to show the lesion), do NOT invent a confident diagnosis: set "assessmentPossible" to false and list specific, actionable items in "moreInfoNeeded" (e.g. 'Take a closer, well-lit photo', 'Add another angle', 'Tell us how long the lesion has been present'). Otherwise set "assessmentPossible" to true and leave "moreInfoNeeded" as an empty array.

Respond with a SINGLE valid JSON object and NOTHING ELSE (no markdown, no code fences). Use exactly this shape:
{
  "imageQuality": { "score": "Excellent|Good|Fair|Poor", "feedback": "string" },
  "assessmentPossible": true,
  "moreInfoNeeded": [ "string" ],
  "mostLikelyDiagnosis": { "conditionName": "string", "confidence": "High|Medium|Low", "description": "string", "urgency": "Routine|Requires Prompt Attention|Urgent", "urgencyReason": "string" },
  "differentialDiagnoses": [ { "conditionName": "string", "confidence": "High|Medium|Low", "description": "string" } ],
  "redFlags": [ "string" ],
  "nextSteps": [ "string" ],
  "disclaimer": "string"
}
When assessmentPossible is false, still fill mostLikelyDiagnosis with conditionName 'Insufficient information', confidence 'Low' and a short explanation.
The disclaimer must clearly state this is an AI-generated analysis and not a substitute for professional medical advice.`;

export function buildAnalysisPrompt(
  imageCount: number,
  history?: ClinicalHistory,
  viewLabels?: string[],
): string {
  const parts: string[] = [];

  if (imageCount === 1) {
    parts.push(
      "You are evaluating this case using a single clinical photograph. Carefully assess the visible " +
        "findings, but recognize the limitations of a single image. Do not infer features that cannot be " +
        "reliably seen. Generate a reasonable ranked differential diagnosis and communicate uncertainty " +
        "appropriately.",
    );
  } else {
    parts.push(
      `You are evaluating ${imageCount} photographs of the SAME lesion or eruption taken from different ` +
        "views, distances, or angles. Treat them as one clinical case. Integrate information across all " +
        "images rather than diagnosing each photograph independently.",
    );
    const labels = (viewLabels ?? []).filter(Boolean).join(", ");
    if (labels) parts.push(`The photographs are labelled by the user as: ${labels}.`);
  }

  const supplied = HISTORY_FIELDS.filter((f) => (history?.[f.key] ?? "").trim().length > 0).map(
    (f) => `- ${f.clinicalLabel}: ${(history![f.key] ?? "").trim()}`,
  );

  if (supplied.length) {
    parts.push(
      "Integrate the supplied clinical history, symptoms, anatomical location, duration, evolution, " +
        "medications, exposures, and other relevant information with the visual findings when generating " +
        "the differential assessment.\n\nClinical history provided by the patient:\n" +
        supplied.join("\n"),
    );
  } else {
    parts.push(
      "No clinical history was provided. Base your assessment on the image(s) alone and say so where relevant.",
    );
  }

  parts.push("Return ONLY the JSON object described in your instructions.");
  return parts.join("\n\n");
}

function extractJson(text: string): any {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("No JSON object found");
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

export async function analyzeImages(
  imagesBase64: string[],
  extra?: { history?: ClinicalHistory; viewLabels?: string[] },
): Promise<Diagnosis> {
  if (!API_KEY) {
    throw new Error("No Gemini API key is configured in this build.");
  }
  if (imagesBase64.length === 0) throw new Error("Please add at least one photo.");

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [
      {
        parts: [
          { text: buildAnalysisPrompt(imagesBase64.length, extra?.history, extra?.viewLabels) },
          ...imagesBase64.map((b64) => ({
            inline_data: { mime_type: "image/jpeg", data: b64.replace(/^data:[^,]+,/, "") },
          })),
        ],
      },
    ],
    generationConfig: { responseMimeType: "application/json", temperature: 0.4 },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180000);
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY },
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
    const detail = await res.text().catch(() => "");
    if (res.status === 400 && /API key/i.test(detail)) throw new Error("The Gemini API key in this build is invalid.");
    if (res.status === 429) throw new Error("The AI is rate limited right now. Please try again in a moment.");
    throw new Error(`AI analysis failed (${res.status}). Please try again.`);
  }

  const json = await res.json();
  const text: string = json?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? "").join("") ?? "";
  if (!text.trim()) throw new Error("The AI returned an empty response. Please try again.");

  let parsed: any;
  try {
    parsed = extractJson(text);
  } catch {
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
