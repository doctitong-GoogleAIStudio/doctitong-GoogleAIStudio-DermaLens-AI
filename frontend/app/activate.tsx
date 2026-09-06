import { useState } from "react";
import { View, Text, Pressable, Image } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import Ionicons from "@react-native-vector-icons/ionicons";

import { Button } from "@/src/components/Button";
import { Field } from "@/src/components/Field";
import { useTrial } from "@/src/trial";
import { useTheme, makeStyles, spacing, radius, fonts, fontSize } from "@/src/theme";

export default function Activate() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { deviceId, activated, expired, activate, requestActivation } = useTrial();

  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [requestState, setRequestState] = useState<"idle" | "sending" | "sent">("idle");

  const canClose = !expired || activated;

  const copyId = async () => {
    await Clipboard.setStringAsync(deviceId);
    setCopied(true);
    Haptics.selectionAsync();
    setTimeout(() => setCopied(false), 1500);
  };

  const onActivate = async () => {
    setError(null);
    if (!key.trim()) {
      setError("Please enter your activation key.");
      return;
    }
    setLoading(true);
    const ok = await activate(key);
    setLoading(false);
    if (ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/(tabs)");
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError("Invalid activation key for this device.");
    }
  };

  const onRequest = async () => {
    setRequestState("sending");
    try {
      await requestActivation();
      setRequestState("sent");
    } catch {
      setRequestState("idle");
      setError("Could not send your request. Please check your connection.");
    }
  };

  return (
    <View style={styles.root}>
      <KeyboardAwareScrollView
        bottomOffset={90}
        contentContainerStyle={{ paddingBottom: 140, paddingTop: insets.top + spacing.lg }}
        showsVerticalScrollIndicator={false}
      >
        {canClose && (
          <Pressable style={[styles.closeBtn, { top: insets.top + spacing.sm }]} onPress={() => router.back()} testID="activate-close">
            <Ionicons name="close" size={24} color={colors.onSurface} />
          </Pressable>
        )}

        <View style={styles.head}>
          <View style={styles.lockIcon}>
            <Ionicons name={activated ? "shield-checkmark" : "lock-closed"} size={30} color={colors.onBrandPrimary} />
          </View>
          <Text style={styles.title}>{activated ? "Device Activated" : "Activate this Device"}</Text>
          <Text style={styles.subtitle}>
            {activated
              ? "Your device has full access. Thank you!"
              : expired
                ? "Your 7-day free trial has ended. Activate this device to continue."
                : "Activate your device anytime for permanent, unlimited access."}
          </Text>
        </View>

        {/* Device ID */}
        <Text style={styles.label}>Your Device ID</Text>
        <Pressable style={styles.idCard} onPress={copyId} testID="device-id-card">
          <Text style={styles.idText} selectable>
            {deviceId || "…"}
          </Text>
          <View style={styles.copyBtn}>
            <Ionicons name={copied ? "checkmark" : "copy-outline"} size={18} color={colors.brandPrimary} />
            <Text style={styles.copyText}>{copied ? "Copied" : "Copy"}</Text>
          </View>
        </Pressable>

        {!activated && (
          <>
            {/* Payment */}
            <Text style={styles.label}>Pay via GCash</Text>
            <View style={styles.qrCard}>
              <View style={styles.qrBox}>
                <Image
                  source={require("@/assets/images/gcash-qr.png")}
                  style={styles.qrImage}
                  resizeMode="contain"
                  accessibilityLabel="GCash QR code"
                />
              </View>
              <Text style={styles.qrFees}>Transfer fees may apply.</Text>
              <Text style={styles.qrName}>AiDerma</Text>
              <Text style={styles.qrAmount}>₱ 1,500.00</Text>
              <Text style={styles.qrHint}>Scan to pay, then send your Device ID for your activation key.</Text>
            </View>

            <Pressable style={styles.requestBtn} onPress={onRequest} disabled={requestState !== "idle"} testID="send-device-id">
              <Ionicons
                name={requestState === "sent" ? "checkmark-circle" : "paper-plane-outline"}
                size={18}
                color={colors.brandPrimary}
              />
              <Text style={styles.requestText}>
                {requestState === "sending"
                  ? "Sending…"
                  : requestState === "sent"
                    ? "Request sent — we'll send your key soon"
                    : "Send my Device ID for activation"}
              </Text>
            </Pressable>

            {/* Key entry */}
            <View style={{ marginTop: spacing.xl }}>
              <Field
                label="Activation Key"
                value={key}
                onChangeText={(t) => setKey(t.toUpperCase())}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                autoCapitalize="characters"
                autoCorrect={false}
                style={{ fontFamily: fonts.monoMedium, letterSpacing: 1 }}
                containerTestID="activation-key-field"
              />
            </View>

            {error && (
              <Text style={styles.error} testID="activate-error">
                {error}
              </Text>
            )}
          </>
        )}
      </KeyboardAwareScrollView>

      {!activated && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
          <Button label="Activate" onPress={onActivate} loading={loading} testID="activate-submit" />
        </View>
      )}
      {activated && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
          <Button label="Continue" onPress={() => router.replace("/(tabs)")} testID="activated-continue" />
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  closeBtn: { position: "absolute", right: spacing.lg, zIndex: 10, width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary },
  head: { alignItems: "center", paddingHorizontal: spacing.xl, marginBottom: spacing.xl },
  lockIcon: { width: 72, height: 72, borderRadius: radius.lg, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  title: { fontFamily: fonts.display, fontSize: fontSize["2xl"], color: colors.onSurface, textAlign: "center" },
  subtitle: { fontFamily: fonts.body, fontSize: fontSize.base, color: colors.muted, textAlign: "center", marginTop: spacing.sm, lineHeight: 20 },
  label: { fontFamily: fonts.bodyMedium, fontSize: fontSize.sm, color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: spacing.sm, marginHorizontal: spacing.xl },
  idCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.xl,
  },
  idText: { fontFamily: fonts.monoBold, fontSize: fontSize.xl, color: colors.onSurface, letterSpacing: 2 },
  copyBtn: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  copyText: { fontFamily: fonts.bodySemi, fontSize: fontSize.sm, color: colors.brandPrimary },
  qrCard: {
    alignItems: "center",
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.xl,
    marginHorizontal: spacing.xl,
  },
  qrBox: { backgroundColor: "#FFFFFF", padding: spacing.md, borderRadius: radius.md },
  qrImage: { width: 190, height: 190 },
  qrFees: { fontFamily: fonts.body, fontSize: fontSize.sm, color: colors.muted, textAlign: "center", marginTop: spacing.md },
  qrName: { fontFamily: fonts.displaySemi, fontSize: fontSize.xl, color: colors.brandPrimary, textAlign: "center", marginTop: spacing.sm },
  qrAmount: { fontFamily: fonts.displaySemi, fontSize: fontSize["2xl"], color: colors.onSurface, textAlign: "center", marginTop: spacing.xs },
  qrHint: { fontFamily: fonts.body, fontSize: fontSize.sm, color: colors.muted, textAlign: "center", marginTop: spacing.md, lineHeight: 18 },
  requestBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, marginTop: spacing.md, marginHorizontal: spacing.xl, paddingVertical: spacing.md },
  requestText: { fontFamily: fonts.bodySemi, fontSize: fontSize.base, color: colors.brandPrimary, textAlign: "center" },
  error: { color: colors.error, fontFamily: fonts.bodyMedium, fontSize: fontSize.base, marginHorizontal: spacing.xl, marginTop: spacing.xs },
  footer: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.divider },
}));
