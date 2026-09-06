// Design tokens for AI Dermatologist. Sage-green clinical palette, light + dark.
// Keys mirror the "color" block of /app/design_guidelines.json.

import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  surface: "#FCFDFD",
  onSurface: "#111814",
  surfaceSecondary: "#FFFFFF",
  onSurfaceSecondary: "#111814",
  surfaceTertiary: "#F0F4F2",
  onSurfaceTertiary: "#111814",
  surfaceInverse: "#151F19",
  onSurfaceInverse: "#FFFFFF",
  muted: "#5C7066",

  brand: "#3B6955",
  onBrand: "#FFFFFF",
  brandPrimary: "#3B6955",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#D1E2D9",
  onBrandSecondary: "#1E3B2E",
  brandTertiary: "#E6EFEB",
  onBrandTertiary: "#264D3B",

  success: "#287D4D",
  onSuccess: "#FFFFFF",
  warning: "#A67C00",
  onWarning: "#FFFFFF",
  error: "#B83A4B",
  onError: "#FFFFFF",
  info: "#4A6E7C",
  onInfo: "#FFFFFF",

  border: "#E3EBE7",
  borderStrong: "#B8CCC3",
  divider: "#EBF0ED",
};

const dark: typeof light = {
  surface: "#101412",
  onSurface: "#E6EFEB",
  surfaceSecondary: "#181D1A",
  onSurfaceSecondary: "#E6EFEB",
  surfaceTertiary: "#212925",
  onSurfaceTertiary: "#E6EFEB",
  surfaceInverse: "#FFFFFF",
  onSurfaceInverse: "#111814",
  muted: "#8E9E96",

  brand: "#5C947A",
  onBrand: "#0A140F",
  brandPrimary: "#5C947A",
  onBrandPrimary: "#0A140F",
  brandSecondary: "#213B2E",
  onBrandSecondary: "#A3C7B5",
  brandTertiary: "#182B21",
  onBrandTertiary: "#C2DFD0",

  success: "#40A86E",
  onSuccess: "#000000",
  warning: "#D4A217",
  onWarning: "#000000",
  error: "#E05A6B",
  onError: "#000000",
  info: "#6B9CAE",
  onInfo: "#000000",

  border: "#2B3831",
  borderStrong: "#455C51",
  divider: "#202924",
};

export type ThemeColors = typeof light;

export const defaultScheme = "light" satisfies ColorScheme;
export const themes: { light: ThemeColors; dark?: ThemeColors } = { light, dark };

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, "2xl": 32, "3xl": 48 } as const;
export const radius = { sm: 6, md: 12, lg: 20, pill: 999 } as const;
export const fontSize = { sm: 12, base: 14, lg: 16, xl: 20, "2xl": 24, "3xl": 30 } as const;

// Font families loaded via expo-font in app/_layout.tsx.
export const fonts = {
  display: "PlusJakartaSans-Bold",
  displaySemi: "PlusJakartaSans-SemiBold",
  body: "Geist-Regular",
  bodyMedium: "Geist-Medium",
  bodySemi: "Geist-SemiBold",
  mono: "SpaceGrotesk-Regular",
  monoMedium: "SpaceGrotesk-Medium",
  monoBold: "SpaceGrotesk-Bold",
} as const;

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme);
}

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = system && themes[system] ? system : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.light };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}
