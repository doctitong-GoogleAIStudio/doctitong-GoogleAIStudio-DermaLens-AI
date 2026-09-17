import React from "react";
import { Text, TextInput, View, TextInputProps } from "react-native";

import { makeStyles, useTheme, radius, spacing, fonts, fontSize } from "@/src/theme";

interface FieldProps extends TextInputProps {
  label: string;
  containerTestID?: string;
  /** Inline validation message shown under the input. */
  error?: string | null;
}

export function Field({ label, containerTestID, error, style, ...props }: FieldProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.wrap} testID={containerTestID}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        style={[styles.input, !!error && { borderColor: colors.error }, style]}
        {...props}
      />
      {!!error && (
        <Text style={styles.fieldError} testID={containerTestID ? `${containerTestID}-error` : undefined}>
          {error}
        </Text>
      )}
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
  fieldError: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSize.sm,
    color: colors.error,
    marginTop: spacing.xs,
  },
}));
