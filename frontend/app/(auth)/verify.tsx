import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { useRouter } from "expo-router";
import Ionicons from "@react-native-vector-icons/ionicons";

import { Button } from "@/src/components/Button";
import { useAuth } from "@/src/auth";
import { maskEmail } from "@/src/validation";
import { makeStyles, useTheme, spacing, radius, fonts, fontSize } from "@/src/theme";

const CODE_LENGTH = 6;

export default function Verify() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { pendingSignup, confirmSignUp, resendCode, cancelSignUp } = useAuth();

  const inputRef = useRef<TextInput>(null);
  const [code, setCode] = useState("");
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(pendingSignup?.resendAfterSeconds ?? 60);

  // Nothing to confirm (app reloaded, or the screen was deep-linked) — start over.
  useEffect(() => {
    if (!pendingSignup) router.replace("/(auth)/signup");
  }, [pendingSignup, router]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const submit = async (value: string) => {
    if (value.length !== CODE_LENGTH || loading) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      await confirmSignUp(value);
      // Signed in — the root layout swaps to the app automatically.
    } catch (e: any) {
      setError(e?.message || "That code could not be confirmed. Please try again.");
      setCode("");
      inputRef.current?.focus();
    } finally {
      setLoading(false);
    }
  };

  const onChange = (raw: string) => {
    const digits = raw.replace(/[^0-9]/g, "").slice(0, CODE_LENGTH);
    setCode(digits);
    if (error) setError(null);
    if (digits.length === CODE_LENGTH) submit(digits);
  };

  const onResend = async () => {
    if (cooldown > 0 || resending) return;
    setResending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await resendCode();
      setCooldown(res.resendAfterSeconds ?? 60);
      setNotice("We sent a new code.");
      setCode("");
      inputRef.current?.focus();
    } catch (e: any) {
      setError(e?.message || "Could not send a new code. Please try again.");
    } finally {
      setResending(false);
    }
  };

  const changeEmail = () => {
    cancelSignUp();
    router.replace("/(auth)/signup");
  };

  return (
    <View style={styles.root}>
      <KeyboardAwareScrollView
        bottomOffset={90}
        contentContainerStyle={{ paddingBottom: 120, paddingTop: insets.top + spacing.md }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.body}>
          <Pressable style={styles.back} onPress={changeEmail} testID="verify-back">
            <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
          </Pressable>

          <View style={styles.icon}>
            <Ionicons name="mail-unread-outline" size={30} color={colors.brandPrimary} />
          </View>

          <Text style={styles.title}>Confirm your email</Text>
          <Text style={styles.subtitle}>
            We sent a {CODE_LENGTH}-digit code to{" "}
            <Text style={styles.email}>{pendingSignup ? maskEmail(pendingSignup.email) : ""}</Text>. Enter it below to
            finish creating your account.
          </Text>

          <Pressable style={styles.boxesWrap} onPress={() => inputRef.current?.focus()} testID="verify-code">
            <View style={styles.boxes}>
              {Array.from({ length: CODE_LENGTH }).map((_, i) => {
                const active = focused && (i === code.length || (code.length === CODE_LENGTH && i === CODE_LENGTH - 1));
                return (
                  <View key={i} style={[styles.box, active && { borderColor: colors.brandPrimary, borderWidth: 2 }]}>
                    <Text style={styles.boxText}>{code[i] ?? ""}</Text>
                  </View>
                );
              })}
            </View>
            <TextInput
              ref={inputRef}
              value={code}
              onChangeText={onChange}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              keyboardType="number-pad"
              maxLength={CODE_LENGTH}
              autoFocus
              caretHidden
              textContentType="oneTimeCode"
              autoComplete="sms-otp"
              accessibilityLabel="Verification code"
              style={styles.codeInput}
              testID="verify-code-input"
            />
          </Pressable>

          {!!error && (
            <Text style={styles.error} testID="verify-error">
              {error}
            </Text>
          )}
          {!error && !!notice && (
            <Text style={styles.notice} testID="verify-notice">
              {notice}
            </Text>
          )}

          <Pressable
            onPress={onResend}
            disabled={cooldown > 0 || resending}
            accessibilityRole="button"
            accessibilityState={{ disabled: cooldown > 0 || resending }}
            style={styles.resend}
            testID="verify-resend"
          >
            <Text style={[styles.resendText, cooldown > 0 && { color: colors.muted }]}>
              {resending
                ? "Sending a new code…"
                : cooldown > 0
                  ? `You can ask for a new code in ${cooldown}s`
                  : "Didn't get it? Send a new code"}
            </Text>
          </Pressable>

          <Pressable onPress={changeEmail} style={styles.switch} testID="verify-change-email">
            <Text style={styles.switchText}>
              Wrong address? <Text style={styles.switchLink}>Use a different email</Text>
            </Text>
          </Pressable>
        </View>
      </KeyboardAwareScrollView>

      <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
          <Button
            label="Create account"
            onPress={() => submit(code)}
            loading={loading}
            disabled={code.length !== CODE_LENGTH}
            testID="verify-submit"
          />
        </View>
      </KeyboardStickyView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  body: { paddingHorizontal: spacing.xl },
  back: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceTertiary,
    marginBottom: spacing.xl,
  },
  icon: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  title: { fontFamily: fonts.display, fontSize: fontSize["3xl"], color: colors.onSurface },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: fontSize.base,
    color: colors.muted,
    marginTop: spacing.sm,
    lineHeight: 21,
  },
  email: { fontFamily: fonts.bodySemi, color: colors.onSurface },
  boxesWrap: { marginTop: spacing.xl, position: "relative" },
  boxes: { flexDirection: "row", gap: spacing.sm },
  box: {
    flex: 1,
    height: 60,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  boxText: { fontFamily: fonts.displaySemi, fontSize: fontSize["2xl"], color: colors.onSurface },
  // A real, focusable input laid over the boxes: the digits the user types are
  // drawn by the boxes underneath, so the input itself must not paint anything.
  // `opacity: 0` is what actually guarantees that - Android still renders the
  // glyphs when only `color` is transparent, which printed the code on top of
  // the boxes. The element keeps its full size (and a testID + accessibility
  // label), so taps, autofill, screen readers and test tooling all reach it.
  codeInput: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 60,
    opacity: 0,
    backgroundColor: "transparent",
    color: "transparent",
    textAlign: "center",
    fontSize: fontSize["2xl"],
  },
  error: { color: colors.error, fontFamily: fonts.bodyMedium, fontSize: fontSize.base, marginTop: spacing.lg },
  notice: { color: colors.brandPrimary, fontFamily: fonts.bodyMedium, fontSize: fontSize.base, marginTop: spacing.lg },
  resend: { marginTop: spacing.xl, minHeight: 44, justifyContent: "center" },
  resendText: { fontFamily: fonts.bodySemi, fontSize: fontSize.base, color: colors.brandPrimary },
  switch: { marginTop: spacing.sm, minHeight: 44, justifyContent: "center" },
  switchText: { fontFamily: fonts.body, fontSize: fontSize.base, color: colors.muted },
  switchLink: { fontFamily: fonts.bodySemi, color: colors.brandPrimary },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
}));
