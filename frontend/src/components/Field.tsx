import React from "react";
import { Text, TextInput, View, TextInputProps } from "react-native";

import { makeStyles, useTheme, radius, spacing, fonts, fontSize } from "@/src/theme";

interface FieldProps extends TextInputProps {
  label: string;
  containerTestID?: string;
}

export function Field({ label, containerTestID, style, ...props }: FieldProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.wrap} testID={containerTestID}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        style={[styles.input, style]}
        {...props}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: { marginBottom: spacing.lg },
  label: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSize.base,
    color: colors.muted,
    marginBottom: spacing.sm,
  },
  input: {
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    height: 54,
    fontFamily: fonts.body,
    fontSize: fontSize.lg,
    color: colors.onSurface,
  },
}));
