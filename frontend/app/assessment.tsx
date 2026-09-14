import { View, Text, Pressable, ScrollView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";

import { Button } from "@/src/components/Button";
import { useSubscription } from "@/src/billing";
import { useTheme, makeStyles, spacing, radius, fonts, fontSize } from "@/src/theme";

const RECOMMENDED_VIEWS = [
  "Main / front view",
  "Left-angle view",
  "Right-angle view",
  "Close-up",
];

export default function Assessment() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { canAnalyze } = useSubscription();

  const go = (mode: "quick" | "enhanced", action?: "camera" | "upload") => {
    if (!canAnalyze) {
      router.push("/paywall");
      return;
    }
    router.push({ pathname: "/capture", params: { mode, ...(action ? { action } : {}) } });
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable style={styles.back} onPress={() => router.back()} testID="assessment-close">
          <Ionicons name="close" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>New Skin Assessment</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: insets.bottom + spacing["2xl"] }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.question}>How would you like to analyze the skin lesion?</Text>

        {/* Option 1 — Quick */}
        <View style={styles.card} testID="mode-quick">
          <View style={styles.cardHead}>
            <View style={[styles.badge, { backgroundColor: colors.brandTertiary }]}>
              <Ionicons name="flash-outline" size={22} color={colors.brandPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.kicker}>Option 1 — Quick analysis</Text>
              <Text style={styles.cardTitle}>Single Photo</Text>
            </View>
          </View>
          <Text style={styles.cardText}>
            Take or upload one clear photo of the skin lesion for a quick AI-assisted assessment.
          </Text>
          {Platform.OS !== "web" && (
            <Button
              label="Take One Photo"
              onPress={() => go("quick", "camera")}
              testID="quick-take-photo"
              style={{ marginTop: spacing.lg }}
            />
          )}
          <Button
            label="Upload One Photo"
            variant={Platform.OS === "web" ? "primary" : "secondary"}
            onPress={() => go("quick", "upload")}
            testID="quick-upload-photo"
            style={{ marginTop: spacing.md }}
          />
          <Text style={styles.cardHint}>
            Symptoms and history are optional — you can add them before analyzing, or skip straight to the result.
          </Text>
        </View>

        {/* Option 2 — Enhanced */}
        <View style={styles.card} testID="mode-enhanced">
          <View style={styles.cardHead}>
            <View style={[styles.badge, { backgroundColor: colors.brandTertiary }]}>
              <Ionicons name="layers-outline" size={22} color={colors.brandPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.kicker}>Option 2 — Enhanced analysis</Text>
              <Text style={styles.cardTitle}>Multiple Photos + Clinical History</Text>
            </View>
          </View>
          <Text style={styles.cardText}>
            Provide several views of the same lesion plus symptoms and history to give the AI more information for
            its assessment.
          </Text>

          <Text style={styles.listTitle}>Recommended images (2–4, none are required)</Text>
          {RECOMMENDED_VIEWS.map((v) => (
            <View key={v} style={styles.listRow}>
              <Ionicons name="ellipse" size={6} color={colors.brandPrimary} />
              <Text style={styles.listText}>{v}</Text>
            </View>
          ))}

          <Button
            label="Start Enhanced Assessment"
            onPress={() => go("enhanced")}
            testID="start-enhanced"
            style={{ marginTop: spacing.lg }}
          />
        </View>

        <Text style={styles.footNote}>
          More views and relevant history give the model more clinical context. They are recommended, never required.
        </Text>
      </ScrollView>
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
  back: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceTertiary,
  },
  headerTitle: { fontFamily: fonts.displaySemi, fontSize: fontSize.lg, color: colors.onSurface },
  question: {
    fontFamily: fonts.display,
    fontSize: fontSize["2xl"],
    color: colors.onSurface,
    marginBottom: spacing.xl,
    lineHeight: 32,
  },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.md },
  badge: { width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  kicker: {
    fontFamily: fonts.bodySemi,
    fontSize: fontSize.sm,
    color: colors.brandPrimary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  cardTitle: { fontFamily: fonts.displaySemi, fontSize: fontSize.xl, color: colors.onSurface, marginTop: 2 },
  cardText: { fontFamily: fonts.body, fontSize: fontSize.base, color: colors.onSurfaceSecondary, lineHeight: 20 },
  cardHint: { fontFamily: fonts.body, fontSize: fontSize.sm, color: colors.muted, marginTop: spacing.md, lineHeight: 18 },
  listTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: fontSize.sm,
    color: colors.onSurface,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  listRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 3 },
  listText: { fontFamily: fonts.body, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  footNote: {
    fontFamily: fonts.body,
    fontSize: fontSize.sm,
    color: colors.muted,
    textAlign: "center",
    lineHeight: 18,
  },
}));
