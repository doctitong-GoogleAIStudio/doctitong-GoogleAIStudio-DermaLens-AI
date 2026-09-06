import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { storage } from "@/src/utils/storage";
import type { HistoryItem } from "@/src/types";

const HISTORY_KEY = "diagnosis_history";
export const historyQueryKey = ["history"];

export async function readHistory(): Promise<HistoryItem[]> {
  const raw = await storage.getItem<string>(HISTORY_KEY, "");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as HistoryItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeHistory(items: HistoryItem[]): Promise<void> {
  await storage.setItem(HISTORY_KEY, JSON.stringify(items));
}

export function useHistory() {
  return useQuery({ queryKey: historyQueryKey, queryFn: readHistory });
}

export function useAddHistory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (item: HistoryItem) => {
      const items = await readHistory();
      const next = [item, ...items];
      await writeHistory(next);
      return next;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: historyQueryKey }),
  });
}

export function useClearHistory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await writeHistory([]);
      return [];
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: historyQueryKey }),
  });
}

export function useSetNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) => {
      const items = await readHistory();
      const next = items.map((i) => (i.id === id ? { ...i, note } : i));
      await writeHistory(next);
      return next;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: historyQueryKey }),
  });
}

export function useDeleteHistory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const items = await readHistory();
      const next = items.filter((i) => i.id !== id);
      await writeHistory(next);
      return next;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: historyQueryKey }),
  });
}
