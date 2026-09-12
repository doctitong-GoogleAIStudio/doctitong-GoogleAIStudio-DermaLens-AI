import { useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";

import { Button } from "@/src/components/Button";
import { useSubscription, type PlanKey } from "@/src/billing";
import { useTheme, makeStyles, spacing, radius, fonts, fontSize } from "@/src/theme";

const BENEFITS = [
  "Unlimited AI skin analyses",
  "Quick and Enhanced assessments",
  "Multi-view photos + clinical history",
  "PDF reports for every scan",
  "Your full scan history on this phone",
];

export default function Paywall() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { available, connected, isSubscribed, plans, loadingPlans, isPurchasing, error, buy, refresh, clearError, freeLeft } =
    useSubscription();
  const [selected, setSelected] = useState<PlanKey>("yearly");
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    clearError();
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
        <Text style={styles.headerTitle}>Go Premium</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: insets.bottom + spacing["2xl"] }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name="sparkles" size={30} color={colors.brandPrimary} />
          </View>
          <Text style={styles.title}>
            {isSubscribed
              ? "You're subscribed"
              : freeLeft > 0
                ? "Unlimited AI skin analyses"
                : "Your free analysis has been used"}
          </Text>
          <Text style={styles.subtitle}>
            {isSubscribed
              ? "Your subscription is active. Enjoy unlimited AI skin analyses."
              : "Subscribe to keep analyzing skin lesions with AI, as often as you need."}
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
              Subscriptions are purchased through Google Play, so they are only available in the Android app. Analyses
              are not limited here.
            </Text>
          </View>
        ) : isSubscribed ? (
          <View style={styles.notice} testID="paywall-active">
            <Text style={styles.noticeText}>
              Manage or cancel your plan any time in Google Play → Payments & subscriptions.
            </Text>
          </View>
        ) : loadingPlans || !connected ? (
          <View style={styles.loading} testID="paywall-loading">
            <ActivityIndicator color={colors.brandPrimary} />
            <Text style={styles.noticeText}>Loading plans from Google Play…</Text>
          </View>
        ) : plans.length === 0 ? (
          <View style={styles.notice} testID="paywall-empty">
            <Text style={styles.noticeText}>
              Subscription options are unavailable right now. Please try again later.
            </Text>
          </View>
        ) : (
          <View testID="paywall-plans">
            {plans.map((p) => {
              const active = selected === p.plan;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => setSelected(p.plan)}
                  style={[styles.plan, active && { borderColor: colors.brandPrimary, borderWidth: 2 }]}
                  testID={`plan-${p.plan}`}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.planTitle}>{p.title}</Text>
                    <Text style={styles.planPeriod}>{p.period}</Text>
                  </View>
                  <Text style={styles.planPrice}>{p.price}</Text>
                  <Ionicons
                    name={active ? "radio-button-on" : "radio-button-off"}
                    size={22}
                    color={active ? colors.brandPrimary : colors.borderStrong}
                  />
                </Pressable>
              );
            })}

            <Button
              label={`Subscribe ${selected === "monthly" ? "Monthly" : "Yearly"}`}
              onPress={() => buy(selected)}
              loading={isPurchasing}
              testID="paywall-subscribe"
              style={{ marginTop: spacing.lg }}
            />
            <Text style={styles.fine}>
              Billed through your Google Play account and renews automatically until cancelled. Cancel any time in
              Google Play.
            </Text>
          </View>
        )}

        {!!error && (
          <Text style={styles.error} testID="paywall-error">
            {error}
          </Text>
        )}

        {available && !isSubscribed && (
          <Button
            label="Already subscribed? Refresh"
            variant="ghost"
            loading={refreshing}
            onPress={onRefresh}
            testID="paywall-refresh"
            style={{ marginTop: spacing.md }}
          />
        )}
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
