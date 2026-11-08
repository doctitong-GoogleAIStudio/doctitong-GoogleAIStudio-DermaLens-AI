import { useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";

import { Button } from "@/src/components/Button";
import { useCredits } from "@/src/billing";
import { useTheme, makeStyles, spacing, radius, fonts, fontSize } from "@/src/theme";

const BENEFITS = [
  "Quick and Enhanced assessments",
  "Multi-view photos + clinical history",
  "PDF reports for every scan",
  "Your full scan history on this phone",
  "Credits never expire",
];

export default function BuyCredits() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    available,
    connected,
    credits,
    freeLeft,
    packs,
    loadingPacks,
    isPurchasing,
    error,
    buy,
    restore,
    refresh,
    clearError,
  } = useCredits();
  const [selected, setSelected] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const chosen = selected ?? packs[packs.length - 1]?.id ?? null;

  const onRefresh = async () => {
    setRefreshing(true);
    clearError();
    await restore();
    await refresh();
    setRefreshing(false);
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable
          style={styles.back}
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)"))}
          testID="paywall-close"
        >
          <Ionicons name="close" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Buy Credits</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: insets.bottom + spacing["2xl"] }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name="flash" size={30} color={colors.brandPrimary} />
          </View>
          <Text style={styles.title}>
            {credits > 0 ? `${credits} credit${credits === 1 ? "" : "s"} left` : "Out of credits"}
          </Text>
          <Text style={styles.subtitle}>
            {credits > 0
              ? "One credit runs one AI analysis. Top up whenever you need more."
              : freeLeft > 0
                ? "Your free analysis is still available. Buy credits for more."
                : "One credit runs one AI analysis. They never expire."}
          </Text>
        </View>

        <View style={styles.benefits}>
          {BENEFITS.map((b) => (
            <View key={b} style={styles.benefitRow}>
              <Ionicons name="checkmark-circle" size={20} color={colors.brandPrimary} />
              <Text style={styles.benefitText}>{b}</Text>
            </View>
          ))}
        </View>

        {!available ? (
          <View style={styles.notice} testID="paywall-unavailable">
            <Text style={styles.noticeText}>
              Purchases are only available in the Android app from Google Play. Analyses are not limited here.
            </Text>
          </View>
        ) : loadingPacks || !connected ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.brandPrimary} />
            <Text style={styles.noticeText}>Loading credit packs…</Text>
          </View>
        ) : packs.length === 0 ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              Credit packs could not be loaded from Google Play. Check your connection and try again.
            </Text>
          </View>
        ) : (
          <>
            {packs.map((p) => {
              const active = p.id === chosen;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => setSelected(p.id)}
                  testID={`pack-${p.id}`}
                  style={[
                    styles.plan,
                    active && { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
                  ]}
                >
                  <Ionicons
                    name={active ? "radio-button-on" : "radio-button-off"}
                    size={22}
                    color={active ? colors.brandPrimary : colors.muted}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.planTitle}>
                      {p.credits} analys{p.credits === 1 ? "is" : "es"}
                    </Text>
                    <Text style={styles.planPeriod}>Never expires</Text>
                  </View>
                  <Text style={styles.planPrice}>{p.price || "—"}</Text>
                </Pressable>
              );
            })}

            <Button
              label={isPurchasing ? "Opening Google Play…" : "Buy credits"}
              onPress={() => {
                if (chosen) void buy(chosen);
              }}
              loading={isPurchasing}
              disabled={isPurchasing || !chosen}
              testID="paywall-buy"
            />

            <Pressable onPress={onRefresh} disabled={refreshing} style={{ marginTop: spacing.lg }}>
              <Text style={styles.fine}>
                {refreshing ? "Checking…" : "Already paid? Tap to restore your purchase"}
              </Text>
            </Pressable>

            <Text style={styles.fine}>
              Payment is charged to your Google Play account. Credits are added to your DermaLens
              account and never expire. One credit is used per completed analysis — if an analysis
              fails, the credit is returned.
            </Text>
          </>
        )}

        {error ? (
          <Text style={styles.error} testID="paywall-error">
            {error}
          </Text>
        ) : null}
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
  hero: { alignItems: "center", marginBottom: spacing.xl },
  heroIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: fontSize["2xl"],
    color: colors.onSurface,
    textAlign: "center",
    lineHeight: 32,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: fontSize.base,
    color: colors.onSurfaceSecondary,
    textAlign: "center",
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  benefits: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.xl,
    gap: spacing.md,
  },
  benefitRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  benefitText: { fontFamily: fonts.body, fontSize: fontSize.base, color: colors.onSurface, flex: 1 },
  plan: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  planTitle: { fontFamily: fonts.displaySemi, fontSize: fontSize.lg, color: colors.onSurface },
  planPeriod: { fontFamily: fonts.body, fontSize: fontSize.sm, color: colors.muted, marginTop: 2 },
  planPrice: { fontFamily: fonts.bodySemi, fontSize: fontSize.lg, color: colors.brandPrimary },
  notice: {
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  loading: { alignItems: "center", gap: spacing.md, paddingVertical: spacing.lg },
  noticeText: {
    fontFamily: fonts.body,
    fontSize: fontSize.base,
    color: colors.onSurfaceSecondary,
    lineHeight: 20,
    textAlign: "center",
  },
  fine: {
    fontFamily: fonts.body,
    fontSize: fontSize.sm,
    color: colors.muted,
    lineHeight: 18,
    marginTop: spacing.md,
    textAlign: "center",
  },
  error: {
    fontFamily: fonts.body,
    fontSize: fontSize.base,
    color: colors.error,
    marginTop: spacing.lg,
    textAlign: "center",
  },
}));
