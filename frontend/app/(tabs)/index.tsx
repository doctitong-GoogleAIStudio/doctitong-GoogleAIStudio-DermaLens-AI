import { useState, useCallback } from "react";
import { View, Text, FlatList, Pressable, RefreshControl, Alert, Platform } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";

import { useTheme, makeStyles, spacing, radius, fonts, fontSize } from "@/src/theme";
import { useAuth } from "@/src/auth";
import { useSubscription } from "@/src/billing";
import { useHistory, useDeleteHistory } from "@/src/history";
import { HistoryCard } from "@/src/components/HistoryCard";
import type { HistoryItem } from "@/src/types";

export default function Home() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { available: billingAvailable, isSubscribed, freeLeft, canAnalyze } = useSubscription();
  const { data: history = [], isLoading, refetch } = useHistory();
  const deleteItem = useDeleteHistory();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  // The session is kept on this phone, so signing out is always deliberate.
  const confirmSignOut = useCallback(() => {
    const message = "You'll need your email and password to sign back in on this phone.";
    if (Platform.OS === "web") {
      // react-native-web has no UI for multi-button Alert.alert.
      if (window.confirm(`Sign out?\n\n${message}`)) void signOut();
      return;
    }
    Alert.alert("Sign out?", message, [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => void signOut() },
    ]);
  }, [signOut]);

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
          <Pressable style={styles.iconBtn} onPress={confirmSignOut} testID="header-logout">
            <Ionicons name="log-out-outline" size={22} color={colors.onSurface} />
          </Pressable>
        </View>
      </View>

      {billingAvailable && (
        <Pressable
          style={styles.planBanner}
          onPress={() => router.push("/paywall")}
          testID="plan-banner"
          disabled={isSubscribed}
        >
          <Ionicons
            name={isSubscribed ? "shield-checkmark" : "sparkles-outline"}
            size={18}
            color={colors.brandPrimary}
          />
          <Text style={styles.planBannerText}>
            {isSubscribed
              ? "Premium active — unlimited analyses"
              : freeLeft > 0
                ? `${freeLeft} free analysis left — tap to see plans`
                : "Free analysis used — subscribe to continue"}
          </Text>
          {!isSubscribed && <Ionicons name="chevron-forward" size={18} color={colors.muted} />}
        </Pressable>
      )}

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
        onPress={() => router.push(canAnalyze ? "/assessment" : "/paywall")}
        testID="new-scan-fab"
      >
        <Ionicons name="add" size={32} color={colors.onBrandPrimary} />
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  planBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.xl,
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.brandTertiary,
  },
  planBannerText: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: fontSize.base, color: colors.onBrandTertiary },
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
