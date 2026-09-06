import { useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, Alert } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";

import { Button } from "@/src/components/Button";
import { NoteSheet } from "@/src/components/NoteSheet";
import { useHistory, useSetNote } from "@/src/history";
import { shareReport } from "@/src/report";
import { useTheme, makeStyles, spacing, radius, fonts, fontSize } from "@/src/theme";
import type { HistoryItem } from "@/src/types";

function urgencyToken(colors: any, urgency: string) {
  const u = (urgency || "").toLowerCase();
  if (u.includes("urgent")) return { bg: colors.error, on: colors.onError };
  if (u.includes("prompt")) return { bg: colors.warning, on: colors.onWarning };
  return { bg: colors.success, on: colors.onSuccess };
}

function qualityToken(colors: any, score: string) {
  const s = (score || "").toLowerCase();
  if (s === "excellent") return colors.success;
  if (s === "good") return colors.info;
  if (s === "fair") return colors.warning;
  return colors.error;
}

export default function Result() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: history = [] } = useHistory();
  const [sharing, setSharing] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const setNote = useSetNote();

  const item = useMemo<HistoryItem | undefined>(() => history.find((h) => h.id === id), [history, id]);

  if (!item) {
    return (
      <View style={[styles.root, { alignItems: "center", justifyContent: "center" }]}>
        <Text style={styles.emptyText}>Analysis not found.</Text>
        <Button label="Go Home" onPress={() => router.replace("/(tabs)")} style={{ marginTop: spacing.lg }} />
      </View>
    );
  }

  const d = item.diagnosis;
  const urg = urgencyToken(colors, d.mostLikelyDiagnosis.urgency);
  const qColor = qualityToken(colors, d.imageQuality.score);

  const onShare = async () => {
    setSharing(true);
    try {
      await shareReport(item);
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      // User dismissing the native share/print sheet is not an error.
      if (!/cancel|dismiss/i.test(msg)) {
        Alert.alert("Could not create the report", msg || "Please try again.");
      }
    } finally {
      setSharing(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} testID="result-back">
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Analysis Result</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {/* Images */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
          {item.images.map((uri, i) => (
            <Image key={i} source={{ uri }} style={styles.hero} contentFit="cover" />
          ))}
        </ScrollView>

        {/* Quality pill */}
        <View style={[styles.qualityRow]}>
          <View style={[styles.qualityPill, { backgroundColor: qColor }]}>
            <Ionicons name="sparkles" size={14} color="#FFFFFF" />
            <Text style={styles.qualityPillText}>Quality: {d.imageQuality.score}</Text>
          </View>
          <Text style={styles.resolution}>{item.imageInfo.resolution}</Text>
        </View>
        <Text style={styles.qualityFeedback}>{d.imageQuality.feedback}</Text>

        {/* Most likely */}
        <View style={styles.primaryCard}>
          <Text style={styles.cardKicker}>Most Likely Diagnosis</Text>
          <Text style={styles.condName}>{d.mostLikelyDiagnosis.conditionName}</Text>

          <View style={styles.confRow}>
            <View style={[styles.urgencyBadge, { backgroundColor: urg.bg }]}>
              <Text style={[styles.urgencyText, { color: urg.on }]}>{d.mostLikelyDiagnosis.urgency}</Text>
            </View>
            <View style={styles.confChip}>
              <Text style={styles.confLabel}>Confidence</Text>
              <Text style={styles.confValue}>{d.mostLikelyDiagnosis.confidence}</Text>
            </View>
          </View>

          <Text style={styles.desc}>{d.mostLikelyDiagnosis.description}</Text>
          <View style={styles.reasonBox}>
            <Text style={styles.reasonText}>{d.mostLikelyDiagnosis.urgencyReason}</Text>
          </View>
        </View>

        {/* Differentials */}
        {d.differentialDiagnoses?.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Other Possibilities</Text>
            {d.differentialDiagnoses.map((x, i) => (
              <View key={i} style={styles.card}>
                <View style={styles.diffHead}>
                  <Text style={styles.diffName}>{x.conditionName}</Text>
                  <Text style={styles.diffConf}>{x.confidence}</Text>
                </View>
                <Text style={styles.diffDesc}>{x.description}</Text>
              </View>
            ))}
          </>
        )}

        {/* Next steps */}
        {d.nextSteps?.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Recommended Next Steps</Text>
            <View style={styles.card}>
              {d.nextSteps.map((s, i) => (
                <View key={i} style={styles.stepRow}>
                  <View style={styles.stepDot}>
                    <Ionicons name="checkmark" size={13} color={colors.onBrandPrimary} />
                  </View>
                  <Text style={styles.stepText}>{s}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* My note */}
        <Text style={styles.sectionTitle}>My Note</Text>
        <Pressable style={styles.noteCard} onPress={() => setNoteOpen(true)} testID="note-card">
          <Ionicons
            name={item.note ? "document-text" : "create-outline"}
            size={20}
            color={colors.brandPrimary}
          />
          <Text
            style={[styles.noteText, !item.note && { color: colors.muted }]}
            testID="note-text"
          >
            {item.note || "Add a note — e.g. “itchy for 2 weeks”"}
          </Text>
          <Text style={styles.noteAction}>{item.note ? "Edit" : "Add"}</Text>
        </Pressable>

        {/* Disclaimer */}
        <View style={styles.disclaimer}>
          <Ionicons name="warning" size={18} color={colors.warning} />
          <Text style={styles.disclaimerText}>{d.disclaimer}</Text>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button
          label="Share / Download PDF"
          onPress={onShare}
          loading={sharing}
          icon={<Ionicons name="share-outline" size={20} color={colors.onBrandPrimary} />}
          testID="share-pdf-btn"
        />
        <Pressable style={styles.newScan} onPress={() => router.replace("/capture")} testID="new-analysis-btn">
          <Text style={styles.newScanText}>Start New Analysis</Text>
        </Pressable>
      </View>

      <NoteSheet
        visible={noteOpen}
        value={item.note}
        onClose={() => setNoteOpen(false)}
        onSave={(note) => {
          setNote.mutate({ id: item.id, note });
          setNoteOpen(false);
        }}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontFamily: fonts.displaySemi, fontSize: fontSize.lg, color: colors.onSurface },
  emptyText: { fontFamily: fonts.body, fontSize: fontSize.lg, color: colors.muted },
  hero: { width: 160, height: 160, borderRadius: radius.lg, backgroundColor: colors.surfaceTertiary },
  qualityRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.lg },
  noteCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  noteText: { flex: 1, fontFamily: fonts.body, fontSize: fontSize.base, color: colors.onSurface, lineHeight: 20 },
  noteAction: { fontFamily: fonts.bodySemi, fontSize: fontSize.sm, color: colors.brandPrimary },
  qualityPill: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill },
  qualityPillText: { fontFamily: fonts.bodySemi, fontSize: fontSize.sm, color: "#FFFFFF" },
  resolution: { fontFamily: fonts.mono, fontSize: fontSize.sm, color: colors.muted },
  qualityFeedback: { fontFamily: fonts.body, fontSize: fontSize.base, color: colors.muted, marginTop: spacing.sm, lineHeight: 20 },
  primaryCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.brandPrimary,
    padding: spacing.lg,
    marginTop: spacing.xl,
  },
  cardKicker: { fontFamily: fonts.bodyMedium, fontSize: fontSize.sm, color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5 },
  condName: { fontFamily: fonts.display, fontSize: fontSize["2xl"], color: colors.brandPrimary, marginTop: spacing.xs },
  confRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.md },
  urgencyBadge: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill },
  urgencyText: { fontFamily: fonts.bodySemi, fontSize: fontSize.sm },
  confChip: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  confLabel: { fontFamily: fonts.body, fontSize: fontSize.sm, color: colors.muted },
  confValue: { fontFamily: fonts.monoMedium, fontSize: fontSize.base, color: colors.onSurface },
  desc: { fontFamily: fonts.body, fontSize: fontSize.base, color: colors.onSurfaceSecondary, marginTop: spacing.md, lineHeight: 21 },
  reasonBox: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  reasonText: { fontFamily: fonts.body, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, lineHeight: 19 },
  sectionTitle: { fontFamily: fonts.displaySemi, fontSize: fontSize.lg, color: colors.onSurface, marginTop: spacing.xl, marginBottom: spacing.md },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.md },
  diffHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  diffName: { fontFamily: fonts.bodySemi, fontSize: fontSize.lg, color: colors.onSurface, flex: 1 },
  diffConf: { fontFamily: fonts.monoMedium, fontSize: fontSize.sm, color: colors.muted },
  diffDesc: { fontFamily: fonts.body, fontSize: fontSize.base, color: colors.muted, marginTop: spacing.xs, lineHeight: 20 },
  stepRow: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.md, alignItems: "flex-start" },
  stepDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", marginTop: 1 },
  stepText: { fontFamily: fonts.body, fontSize: fontSize.base, color: colors.onSurfaceSecondary, flex: 1, lineHeight: 21 },
  disclaimer: {
    flexDirection: "row",
    gap: spacing.md,
    backgroundColor: colors.surfaceTertiary,
    borderLeftWidth: 4,
    borderLeftColor: colors.warning,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginTop: spacing.xl,
  },
  disclaimerText: { fontFamily: fonts.body, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, flex: 1, lineHeight: 19 },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  newScan: { alignItems: "center", paddingVertical: spacing.md, marginTop: spacing.xs },
  newScanText: { fontFamily: fonts.bodySemi, fontSize: fontSize.base, color: colors.brandPrimary },
}));
