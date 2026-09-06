import { useEffect } from "react";
import { View, Text, Dimensions } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSequence,
  withSpring,
  withRepeat,
  Easing,
} from "react-native-reanimated";
import Ionicons from "@react-native-vector-icons/ionicons";

import { Button } from "@/src/components/Button";
import { useTheme, makeStyles, spacing, radius, fonts, fontSize } from "@/src/theme";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

const CONFETTI = Array.from({ length: 14 }, (_, i) => ({
  x: (i * 137) % (SCREEN_W - 40),
  delay: (i % 7) * 120,
  size: 8 + (i % 3) * 4,
  rotate: (i % 2 === 0 ? 1 : -1) * 240,
}));

function Confetti({ index }: { index: number }) {
  const c = CONFETTI[index];
  const { colors } = useTheme();
  const palette = [colors.brandPrimary, colors.brand, colors.success, colors.warning];
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(c.delay, withTiming(1, { duration: 2200, easing: Easing.out(Easing.quad) }));
  }, []);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateY: progress.value * (SCREEN_H * 0.6) },
      { rotate: `${progress.value * c.rotate}deg` },
    ],
    opacity: 1 - progress.value,
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          top: -20,
          left: c.x + 20,
          width: c.size,
          height: c.size,
          borderRadius: 2,
          backgroundColor: palette[index % palette.length],
        },
        style,
      ]}
    />
  );
}

export function ActivationCelebration({ name, onContinue }: { name: string; onContinue: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const scale = useSharedValue(0.4);
  const glow = useSharedValue(0);
  const contentY = useSharedValue(24);

  useEffect(() => {
    scale.value = withSequence(withSpring(1.12, { damping: 8 }), withSpring(1, { damping: 12 }));
    glow.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }), -1, true);
    contentY.value = withDelay(200, withSpring(0, { damping: 14 }));
  }, []);

  const badgeStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const glowStyle = useAnimatedStyle(() => ({
    opacity: 0.25 + glow.value * 0.35,
    transform: [{ scale: 1 + glow.value * 0.18 }],
  }));
  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: contentY.value }],
    opacity: 1 - contentY.value / 30,
  }));

  const firstName = (name || "").trim().split(" ")[0] || "there";

  return (
    <View style={styles.root} testID="activation-celebration">
      {CONFETTI.map((_, i) => (
        <Confetti key={i} index={i} />
      ))}

      <View style={styles.center}>
        <View style={styles.badgeWrap}>
          <Animated.View style={[styles.glow, glowStyle]} />
          <Animated.View style={[styles.badge, badgeStyle]}>
            <Ionicons name="shield-checkmark" size={54} color={colors.onBrandPrimary} />
          </Animated.View>
        </View>

        <Animated.View style={contentStyle}>
          <Text style={styles.kicker}>Activation successful</Text>
          <Text style={styles.title} testID="celebration-name">
            Welcome, {firstName}!
          </Text>
          <Text style={styles.body}>
            This device now has permanent, unlimited access to AI Dermatologist. No more trial countdown — scan
            anytime.
          </Text>
        </Animated.View>
      </View>

      <View style={styles.footer}>
        <Button label="Start scanning" onPress={onContinue} testID="celebration-continue" />
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, zIndex: 50 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl },
  badgeWrap: { alignItems: "center", justifyContent: "center", marginBottom: spacing.xl },
  glow: {
    position: "absolute",
    width: 150,
    height: 150,
    borderRadius: radius.pill,
    backgroundColor: colors.brandTertiary,
  },
  badge: {
    width: 110,
    height: 110,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  kicker: {
    fontFamily: fonts.bodySemi,
    fontSize: fontSize.sm,
    color: colors.brandPrimary,
    textTransform: "uppercase",
    letterSpacing: 1,
    textAlign: "center",
  },
  title: {
    fontFamily: fonts.display,
    fontSize: fontSize["3xl"],
    color: colors.onSurface,
    textAlign: "center",
    marginTop: spacing.sm,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: fontSize.base,
    color: colors.muted,
    textAlign: "center",
    marginTop: spacing.md,
    lineHeight: 22,
  },
  footer: { paddingHorizontal: spacing.xl, paddingBottom: spacing["2xl"] },
}));
