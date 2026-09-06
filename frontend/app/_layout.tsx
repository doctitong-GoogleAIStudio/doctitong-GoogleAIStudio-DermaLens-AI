import "react-native-reanimated";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { LogBox } from "react-native";

import { ErrorBoundary } from "@/src/components/error-boundary";
import { queryClient } from "@/src/query-client";
import { AuthProvider, useAuth } from "@/src/auth";
import { TrialProvider, useTrial } from "@/src/trial";
import { useTheme } from "@/src/theme";

LogBox.ignoreAllLogs(true);
SplashScreen.preventAutoHideAsync();

function Gate() {
  const { ready: authReady, user } = useAuth();
  const { ready: trialReady, expired, activated } = useTrial();
  const { colors } = useTheme();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!authReady || !trialReady) return;
    const group = segments[0];
    const inAuth = group === "(auth)";
    const onActivate = group === "activate";
    // "/" renders the bootstrap spinner only — authenticated users must be
    // moved off it, otherwise a page refresh leaves them stuck loading.
    const atRoot = segments.length === 0;

    if (!user) {
      if (!inAuth) router.replace("/(auth)/login");
      return;
    }
    if (expired && !activated) {
      if (!onActivate) router.replace("/activate");
      return;
    }
    // Authenticated + within trial (or activated): allow visiting /activate
    // voluntarily; only bounce away from the auth screens and the bootstrap route.
    if (inAuth || atRoot) router.replace("/(tabs)");
  }, [authReady, trialReady, user, expired, activated, segments, router]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }}>
        <Stack.Screen name="capture" options={{ presentation: "fullScreenModal", animation: "slide_from_bottom" }} />
        <Stack.Screen name="result" options={{ presentation: "card" }} />
        <Stack.Screen name="activate" options={{ gestureEnabled: false }} />
      </Stack>
    </View>
  );
}

export default function RootLayout() {
  const [loaded, fontError] = useFonts({
    "PlusJakartaSans-Bold": require("../assets/fonts/PlusJakartaSans-Bold.ttf"),
    "PlusJakartaSans-SemiBold": require("../assets/fonts/PlusJakartaSans-SemiBold.ttf"),
    "Geist-Regular": require("../assets/fonts/Geist-Regular.ttf"),
    "Geist-Medium": require("../assets/fonts/Geist-Medium.ttf"),
    "Geist-SemiBold": require("../assets/fonts/Geist-SemiBold.ttf"),
    "SpaceGrotesk-Regular": require("../assets/fonts/SpaceGrotesk-Regular.ttf"),
    "SpaceGrotesk-Medium": require("../assets/fonts/SpaceGrotesk-Medium.ttf"),
    "SpaceGrotesk-Bold": require("../assets/fonts/SpaceGrotesk-Bold.ttf"),
  });

  // Fonts must never be able to block the app from opening.
  const [fontTimeout, setFontTimeout] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setFontTimeout(true), 4000);
    return () => clearTimeout(t);
  }, []);

  const canRender = loaded || !!fontError || fontTimeout;

  useEffect(() => {
    if (canRender) SplashScreen.hideAsync().catch(() => {});
  }, [canRender]);

  if (!canRender) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <ErrorBoundary>
            <QueryClientProvider client={queryClient}>
              <AuthProvider>
                <TrialProvider>
                  <StatusBar style="auto" />
                  <Gate />
                </TrialProvider>
              </AuthProvider>
            </QueryClientProvider>
          </ErrorBoundary>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
