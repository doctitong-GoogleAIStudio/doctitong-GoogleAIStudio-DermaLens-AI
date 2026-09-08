import { useState, useCallback } from "react";
import { View, Text, FlatList, Pressable, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";

import { useTheme, makeStyles, spacing, radius, fonts, fontSize } from "@/src/theme";
import { useTrial, formatCountdown } from "@/src/trial";
import { useAuth } from "@/src/auth";
import { useHistory, useDeleteHistory } from "@/src/history";
import { HistoryCard } from "@/src/components/HistoryCard";
import type { HistoryItem } from "@/src/types";

function TrialBanner() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const { activated, msRemaining, ready } = useTrial();
  if (!ready) return null;

  if (activated) {
    return (
      <View style={[styles.banner, { backgroundColor: colors.brandTertiary }]} testID="trial-banner">
        <Ionicons name="shield-checkmark" size={22} color={colors.brandPrimary} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.bannerTitle, { color: colors.onBrandTertiary }]}>Device Activated</Text>
          <Text style={[styles.bannerSub, { color: colors.brandPrimary }]}>Full access unlocked</Text>
        </View>
      </View>
    );
  }

  const c = formatCountdown(msRemaining);
  const total = 7 * 24 * 60 * 60 * 1000;
  const pct = Math.max(0, Math.min(1, msRemaining / total));

  return (
    <Pressable
      style={[styles.banner, { backgroundColor: colors.surfaceInverse }]}
      onPress={() => router.push("/activate")}
      testID="trial-banner"
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.bannerSub, { color: colors.onSurfaceInverse, opacity: 0.7 }]}>7-Day Free Trial</Text>
        <View style={styles.countRow}>
          {[
            { v: c.days, l: "D" },
            { v: c.hours, l: "H" },
            { v: c.minutes, l: "M" },
            { v: c.seconds, l: "S" },
          ].map((seg, i) => (
            <View key={i} style={styles.countSeg}>
              <Text style={[styles.countNum, { color: colors.onSurfaceInverse }]}>
                {String(seg.v).padStart(2, "0")}
              </Text>
              <Text style={[styles.countLbl, { color: colors.onSurfaceInverse, opacity: 0.5 }]}>{seg.l}</Text>
            </View>
          ))}
        </View>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: colors.brand }]} />
        </View>
      </View>
      <View style={styles.activateChip}>
        <Text style={[styles.activateChipText, { color: colors.onBrandPrimary }]}>Activate</Text>
      </View>
    </Pressable>
  );
}

export default function Home() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { data: history = [], isLoading, refetch } = useHistory();
  const deleteItem = useDeleteHistory();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const renderItem = ({ item }: { item: HistoryItem }) => (
    <HistoryCard
      item={item}
      onPress={() => router.push({ pathname: "/result", params: { id: item.id } })}
      onDelete={() => deleteItem.mutate(item.id)}
    />
  );

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View>
          <Text style={styles.brand}>AI Dermatologist</Text>
          <Text style={styles.hi} numberOfLines={1}>
            {user ? `Hi, ${user.full_name.split(" ")[0]}` : "AI Skin Lesion Analysis"}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable style={styles.iconBtn} onPress={() => router.push("/activate")} testID="header-activate">
            <Ionicons name="key-outline" size={22} color={colors.onSurface} />
          </Pressable>
          <Pressable style={styles.iconBtn} onPress={signOut} testID="header-logout">
            <Ionicons name="log-out-outline" size={22} color={colors.onSurface} />
          </Pressable>
        </View>
      </View>

      <View style={styles.bannerWrap}>
        <TrialBanner />
      </View>

      <FlatList
        data={history}
        keyExtractor={(i) => i.id}
        renderItem={renderItem}
        contentContainerStyle={{ paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: 140 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.brandPrimary}
            colors={[colors.brandPrimary]}
            testID="history-refresh"
          />
        }
        ListHeaderComponent={
          history.length > 0 ? (
            <View>
              <Text style={styles.sectionTitle}>Recent Analyses</Text>
              <Text style={styles.sectionHint}>Swipe a scan left to delete it. Pull down to refresh.</Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.empty} testID="history-empty">
              <View style={styles.emptyIcon}>
                <Ionicons name="scan-outline" size={44} color={colors.brandPrimary} />
              </View>
              <Text style={styles.emptyTitle}>No scans yet</Text>
              <Text style={styles.emptyText}>
                Tap the + button to start a new skin assessment and get a preliminary AI analysis.
              </Text>
            </View>
          ) : null
        }
      />

      <Pressable
        style={[styles.fab, { bottom: spacing.xl }]}
        onPress={() => router.push("/assessment")}
        testID="new-scan-fab"
      >
        <Ionicons name="add" size={32} color={colors.onBrandPrimary} />
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },
  brand: { fontFamily: fonts.display, fontSize: fontSize.xl, color: colors.brandPrimary },
  hi: { fontFamily: fonts.body, fontSize: fontSize.base, color: colors.muted, marginTop: 2 },
  headerActions: { flexDirection: "row", gap: spacing.xs },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceTertiary,
  },
  bannerWrap: { paddingHorizontal: spacing.xl, paddingBottom: spacing.md },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  bannerTitle: { fontFamily: fonts.bodySemi, fontSize: fontSize.lg },
  bannerSub: { fontFamily: fonts.bodyMedium, fontSize: fontSize.sm },
  countRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.xs },
  countSeg: { flexDirection: "row", alignItems: "flex-end", gap: 2 },
  countNum: { fontFamily: fonts.monoBold, fontSize: 22 },
  countLbl: { fontFamily: fonts.mono, fontSize: 11, marginBottom: 3 },
  track: { height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.15)", marginTop: spacing.sm, overflow: "hidden" },
  fill: { height: 4, borderRadius: 2 },
  activateChip: {
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  activateChipText: { fontFamily: fonts.bodySemi, fontSize: fontSize.sm },
  sectionTitle: {
    fontFamily: fonts.displaySemi,
    fontSize: fontSize.lg,
    color: colors.onSurface,
  },
  sectionHint: {
    fontFamily: fonts.body,
    fontSize: fontSize.sm,
    color: colors.muted,
    marginTop: 2,
    marginBottom: spacing.md,
  },
  empty: { alignItems: "center", paddingTop: spacing["3xl"], paddingHorizontal: spacing.xl },
  emptyIcon: {
    width: 96,
    height: 96,
    borderRadius: radius.lg,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  emptyTitle: { fontFamily: fonts.displaySemi, fontSize: fontSize.xl, color: colors.onSurface },
  emptyText: {
    fontFamily: fonts.body,
    fontSize: fontSize.base,
    color: colors.muted,
    textAlign: "center",
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  fab: {
    position: "absolute",
    alignSelf: "center",
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
}));
