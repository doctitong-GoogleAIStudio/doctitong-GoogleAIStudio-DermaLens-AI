import { HISTORY_FIELDS, type HistoryItem } from "@/src/types";

export interface InfoLine {
  label: string;
  provided: boolean;
}

/** Summarises exactly what the AI had to work with for this case. */
export function informationUsed(item: HistoryItem): InfoLine[] {
  const photos = item.images?.length ?? 0;
  const lines: InfoLine[] = [
    { label: `${photos} clinical photograph${photos === 1 ? "" : "s"}`, provided: true },
  ];

  const h = item.clinicalHistory ?? {};
  const filled = HISTORY_FIELDS.filter((f) => (h[f.key] ?? "").trim().length > 0);

  if (filled.length === 0) {
    lines.push({ label: "No clinical history provided", provided: false });
    return lines;
  }
  filled.forEach((f) => lines.push({ label: f.clinicalLabel, provided: true }));
  return lines;
}
