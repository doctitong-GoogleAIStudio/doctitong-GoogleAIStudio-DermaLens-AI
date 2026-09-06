import { useState } from "react";
import { View, Text, Pressable } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { useRouter } from "expo-router";

import { Field } from "@/src/components/Field";
import { Button } from "@/src/components/Button";
import { useAuth } from "@/src/auth";
import { makeStyles, useTheme, spacing, fonts, fontSize } from "@/src/theme";

const HERO = {
  light:
    "https://images.unsplash.com/photo-1713085085470-fba013d67e65?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NTJ8MHwxfHNlYXJjaHwxfHxjbGVhbiUyMGRlcm1hdG9sb2dpc3QlMjBjbGluaWMlMjBhZXN0aGV0aWN8ZW58MHx8fHwxNzg4NjY3OTg4fDA&ixlib=rb-4.1.0&q=85&w=1200",
  dark:
    "https://images.unsplash.com/photo-1638376776402-9a4b75fe21bb?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NTYxODl8MHwxfHNlYXJjaHwxfHxkYXJrJTIwbWluaW1hbGlzdCUyMHN1YnRsZSUyMG1lZGljYWwlMjBiYWNrZ3JvdW5kfGVufDB8fHx8MTc4ODY2Nzk5OHww&ixlib=rb-4.1.0&q=85&w=1200",
};

export default function Signup() {
  const styles = useStyles();
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signUp } = useAuth();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isValidEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

  const onSubmit = async () => {
    setError(null);
    if (!fullName.trim()) return setError("Please enter your full name.");
    if (!isValidEmail(email)) return setError("Please enter a valid email address.");
    if (password.length < 6) return setError("Password must be at least 6 characters.");

    setLoading(true);
    try {
      await signUp(fullName, email, password);
    } catch (e: any) {
      setError(e?.message || "Sign up failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.root}>
      <KeyboardAwareScrollView
        bottomOffset={90}
        contentContainerStyle={{ paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <Image source={{ uri: scheme === "dark" ? HERO.dark : HERO.light }} style={styles.heroImg} contentFit="cover" />
          <LinearGradient colors={["transparent", colors.surface]} style={styles.scrim} locations={[0.35, 1]} />
        </View>

        <View style={styles.body}>
          <Text style={styles.title}>Create account</Text>
          <Text style={styles.subtitle}>Start your 7-day free trial</Text>

          <View style={{ marginTop: spacing.xl }}>
            <Field
              label="Full name"
              value={fullName}
              onChangeText={setFullName}
              placeholder="Jane Doe"
              autoCapitalize="words"
              autoComplete="name"
              containerTestID="signup-name"
            />
            <Field
              label="Email address"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              containerTestID="signup-email"
            />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              placeholder="At least 6 characters"
              secureTextEntry
              containerTestID="signup-password"
            />
          </View>

          {error && (
            <Text style={styles.error} testID="signup-error">
              {error}
            </Text>
          )}

          <Pressable onPress={() => router.push("/(auth)/login")} style={styles.switch} testID="go-login">
            <Text style={styles.switchText}>
              Already have an account? <Text style={styles.switchLink}>Log in</Text>
            </Text>
          </Pressable>
        </View>
      </KeyboardAwareScrollView>

      <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
          <Button label="Create account" onPress={onSubmit} loading={loading} testID="signup-submit" />
        </View>
      </KeyboardStickyView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  hero: { height: 260, width: "100%" },
  heroImg: { width: "100%", height: "100%" },
  scrim: { position: "absolute", left: 0, right: 0, bottom: 0, top: 0 },
  body: { paddingHorizontal: spacing.xl, marginTop: -40 },
  title: { fontFamily: fonts.display, fontSize: fontSize["3xl"], color: colors.onSurface },
  subtitle: { fontFamily: fonts.body, fontSize: fontSize.lg, color: colors.muted, marginTop: spacing.xs },
  error: { color: colors.error, fontFamily: fonts.bodyMedium, fontSize: fontSize.base, marginTop: spacing.xs },
  switch: { marginTop: spacing.xl, alignItems: "center" },
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
