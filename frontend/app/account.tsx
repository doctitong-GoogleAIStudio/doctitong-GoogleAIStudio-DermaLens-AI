import { useState } from "react";
import { View, Text, ScrollView, Pressable, TextInput, Alert, Linking, Platform } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";

import { Button } from "@/src/components/Button";
import { useAuth } from "@/src/auth";
import { describeCredits, useCredits } from "@/src/billing";
import { accountDeletionPageUrl, privacyPolicyUrl } from "@/src/api";
import { useTheme, makeStyles, spacing, radius, fonts, fontSize } from "@/src/theme";


const DELETE_CONFIRM_TITLE = "Delete your account?";
const DELETE_CONFIRM_MESSAGE =
  "Are you sure you want to permanently delete your DermaLens AI account? Your account and associated personal data will be deleted, subject to any information that must be retained for legal, security, billing, fraud-prevention, or regulatory purposes.";

const CREDITS_WARNING =
  "Any analysis credits left on this account will be lost. Credits are not refundable and cannot be moved to another account.";

/** Native multi-button Alert, window.confirm on web (react-native-web has no Alert UI). */
function confirmDialog(title: string, message: string, confirmLabel: string): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: confirmLabel, style: "destructive", onPress: () => resolve(true) },
    ]);
  });
}

function notify(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

export default function AccountAndSubscription() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, deleteAccount } = useAuth();
  const { available: billingAvailable, credits, freeLeft, restore, refresh } = useCredits();

  const [password, setPassword] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const description = describeCredits({ credits, freeLeft, available: billingAvailable });

  const onRefresh = async () => {
    setRefreshing(true);
    // Also sweeps Google Play for a purchase that was paid for but never
    // credited; "my credits are missing" is why someone taps this.
    await restore();
    await refresh();
    setRefreshing(false);
  };

  const onDelete = async () => {
    setError(null);
    if (!password) {
      setError("Enter your password to confirm it is you.");
      return;
    }
    if (!acknowledged) {
      setError("Please confirm you understand that deletion is permanent.");
      return;
    }

    if (credits > 0) {
      const proceed = await new Promise<boolean>((resolve) => {
        if (Platform.OS === "web") {
          resolve(window.confirm(`${CREDITS_WARNING}\n\nContinue deleting the account anyway?`));
          return;
        }
        Alert.alert("You still have credits", CREDITS_WARNING, [
          { text: "Keep my account", style: "cancel", onPress: () => resolve(false) },
          { text: "Delete anyway", style: "destructive", onPress: () => resolve(true) },
        ]);
      });
      if (!proceed) return;
    }

    if (!(await confirmDialog(DELETE_CONFIRM_TITLE, DELETE_CONFIRM_MESSAGE, "Delete permanently"))) return;

    setDeleting(true);
    try {
      await deleteAccount(password);
      notify(
        "Account deleted",
        "Your DermaLens AI account and the data on this phone have been deleted. You are now signed out.",
      );
    } catch (e: any) {
      setError(e?.message ?? "Your account could not be deleted. Please try again.");
    } finally {
      setDeleting(false);
    }
  };

  const policyUrl = privacyPolicyUrl();
  const deletionUrl = accountDeletionPageUrl();

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable
          style={styles.back}
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/about"))}
          testID="account-back"
        >
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Account & Subscription</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ padding: spacing.xl, paddingBottom: insets.bottom + spacing["2xl"] }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ---- Signed in as ---- */}
          <View style={styles.card} testID="account-identity">
            <View style={styles.cardHead}>
              <Ionicons name="person-circle-outline" size={20} color={colors.brandPrimary} />
              <Text style={styles.cardTitle}>{user?.full_name ?? "Your account"}</Text>
            </View>
            <Text style={styles.cardText}>{user?.email}</Text>
          </View>

          {/* ---- Manage subscription ---- */}
          <Text style={styles.groupLabel}>Manage Subscription</Text>
          <View style={styles.card} testID="account-subscription">
            <View style={styles.planRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.planName}>Analysis credits</Text>
                <Text style={styles.cardText}>
                  {billingAvailable
                    ? description.detail
                    : "Credits are purchased in the Android app through Google Play. Analyses are not limited here."}
                </Text>
              </View>
              <View
                style={[
                  styles.pill,
                  description.warning
                    ? { backgroundColor: colors.warning }
                    : credits > 0
                      ? { backgroundColor: colors.brandPrimary }
                      : { backgroundColor: colors.surfaceTertiary },
                ]}
                testID="account-status-pill"
              >
                <Text
                  style={[
                    styles.pillText,
                    { color: description.warning ? colors.onWarning : credits > 0 ? colors.onBrandPrimary : colors.muted },
                  ]}
                >
                  {billingAvailable ? description.label : "N/A"}
                </Text>
              </View>
            </View>

            <Text style={styles.cardText}>
              One credit runs one AI analysis and credits never expire. If an analysis fails, the
              credit is returned to your balance. Purchases are charged to your Google Play account.
            </Text>

            {billingAvailable && (
              <Button
                label="Buy credits"
                onPress={() => router.push("/paywall")}
                icon={<Ionicons name="flash" size={18} color={colors.onBrandPrimary} />}
                testID="account-see-plans"
                style={{ marginTop: spacing.lg }}
              />
            )}
            {billingAvailable && (
              <Button
                label="Refresh subscription status"
                variant="ghost"
                loading={refreshing}
                onPress={onRefresh}
                testID="account-refresh-subscription"
                style={{ marginTop: spacing.md }}
              />
            )}
          </View>

          {/* ---- Delete account ---- */}
          <Text style={[styles.groupLabel, { color: colors.error }]}>Delete Account</Text>
          <View style={[styles.card, styles.dangerCard]} testID="account-delete">
            <View style={styles.cardHead}>
              <Ionicons name="warning" size={18} color={colors.error} />
              <Text style={styles.cardTitle}>This cannot be undone</Text>
            </View>
            <Text style={styles.cardText}>
              Deleting your account permanently removes your DermaLens AI account and personal data from our servers,
              and deletes your scan history, photos, notes and reports from this phone. Records that must be kept for
              legal, security, billing, fraud-prevention or regulatory purposes are retained or de-identified as
              described in the Privacy Policy.
            </Text>

            {credits > 0 && (
              <View style={styles.warnBox} testID="account-delete-subscription-warning">
                <Ionicons name="flash-outline" size={18} color={colors.onWarning} />
                <Text style={styles.warnText}>
                  You still have {credits} unused credit{credits === 1 ? "" : "s"}. They will be lost
                  and cannot be refunded or moved to another account.
                </Text>
              </View>
            )}

            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Confirm your password"
              placeholderTextColor={colors.muted}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="current-password"
              testID="account-delete-password"
            />

            <Pressable
              style={styles.checkRow}
              onPress={() => setAcknowledged((v) => !v)}
              testID="account-delete-acknowledge"
              accessibilityRole="checkbox"
              accessibilityState={{ checked: acknowledged }}
            >
              <Ionicons
                name={acknowledged ? "checkbox" : "square-outline"}
                size={22}
                color={acknowledged ? colors.error : colors.muted}
              />
              <Text style={styles.checkText}>
                I understand my account and data will be permanently deleted and that any Google Play subscription
                must be cancelled separately.
              </Text>
            </Pressable>

            {!!error && (
              <Text style={styles.error} testID="account-delete-error">
                {error}
              </Text>
            )}

            <Pressable
              onPress={onDelete}
              disabled={deleting || !password || !acknowledged}
              style={({ pressed }) => [
                styles.dangerButton,
                { opacity: deleting || !password || !acknowledged ? 0.5 : pressed ? 0.9 : 1 },
              ]}
              testID="account-delete-submit"
            >
              <Ionicons name="trash-outline" size={18} color={colors.onError} />
              <Text style={styles.dangerButtonText}>{deleting ? "Deleting…" : "Delete My Account and Data"}</Text>
            </Pressable>

            {!!deletionUrl && (
              <Text style={styles.fine}>
                You can also delete your account without the app at{" "}
                <Text style={styles.link} onPress={() => Linking.openURL(deletionUrl).catch(() => {})}>
                  our account deletion page
                </Text>
                .
              </Text>
            )}
          </View>

          {!!policyUrl && (
            <Pressable
              style={styles.policyRow}
              onPress={() => Linking.openURL(policyUrl).catch(() => {})}
              testID="account-privacy-policy"
            >
              <Ionicons name="document-text-outline" size={18} color={colors.brandPrimary} />
              <Text style={styles.policyText}>Privacy Policy</Text>
              <Ionicons name="open-outline" size={16} color={colors.muted} />
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
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
  groupLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSize.sm,
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  dangerCard: { borderColor: colors.error, borderLeftWidth: 4 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  cardTitle: { fontFamily: fonts.bodySemi, fontSize: fontSize.base, color: colors.onSurface, flex: 1 },
  cardText: { fontFamily: fonts.body, fontSize: fontSize.base, color: colors.onSurfaceSecondary, lineHeight: 20 },
  planRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, marginBottom: spacing.md },
  planName: { fontFamily: fonts.displaySemi, fontSize: fontSize.lg, color: colors.onSurface, marginBottom: 2 },
  pill: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill },
  pillText: { fontFamily: fonts.bodySemi, fontSize: fontSize.sm },
  fine: { fontFamily: fonts.body, fontSize: fontSize.sm, color: colors.muted, lineHeight: 18, marginTop: spacing.md },
  link: { color: colors.brandPrimary, fontFamily: fonts.bodySemi },
  warnBox: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "flex-start",
    backgroundColor: colors.warning,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  warnText: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: fontSize.sm, color: colors.onWarning, lineHeight: 18 },
  input: {
    height: 54,
    marginTop: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    fontFamily: fonts.body,
    fontSize: fontSize.lg,
    color: colors.onSurface,
  },
  checkRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, marginTop: spacing.md },
  checkText: { flex: 1, fontFamily: fonts.body, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, lineHeight: 18 },
  error: { fontFamily: fonts.body, fontSize: fontSize.base, color: colors.error, marginTop: spacing.md },
  dangerButton: {
    height: 54,
    marginTop: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.error,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  dangerButtonText: { fontFamily: fonts.bodySemi, fontSize: fontSize.lg, color: colors.onError },
  policyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  policyText: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: fontSize.base, color: colors.onSurface },
}));
