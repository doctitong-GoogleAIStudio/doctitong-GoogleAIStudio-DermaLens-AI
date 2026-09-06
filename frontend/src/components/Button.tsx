import React from "react";
import { ActivityIndicator, Pressable, Text, View, ViewStyle } from "react-native";

import { makeStyles, useTheme, radius, spacing, fonts, fontSize } from "@/src/theme";

type Variant = "primary" | "secondary" | "ghost";

interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  style?: ViewStyle;
  testID?: string;
}

export function Button({ label, onPress, variant = "primary", loading, disabled, icon, style, testID }: ButtonProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const isDisabled = disabled || loading;

  const bg =
    variant === "primary" ? colors.brandPrimary : variant === "secondary" ? colors.surfaceTertiary : "transparent";
  const fg =
    variant === "primary" ? colors.onBrandPrimary : variant === "secondary" ? colors.onSurfaceTertiary : colors.brandPrimary;

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: bg, opacity: isDisabled ? 0.55 : pressed ? 0.9 : 1 },
        variant === "ghost" && styles.ghost,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.row}>
          {icon}
          <Text style={[styles.label, { color: fg }]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  base: {
    height: 54,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  ghost: { borderWidth: 1, borderColor: colors.border },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  label: { fontFamily: fonts.bodySemi, fontSize: fontSize.lg },
}));
