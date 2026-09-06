import { useRef, useState } from "react";
import { View, Text, Pressable, Platform, ActivityIndicator, ScrollView, Linking } from "react-native";
import { Image } from "expo-image";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import Ionicons from "@react-native-vector-icons/ionicons";

import { Button } from "@/src/components/Button";
import { api } from "@/src/api";
import { useAddHistory } from "@/src/history";
import { makeStyles, spacing, radius, fonts, fontSize } from "@/src/theme";
import type { HistoryItem } from "@/src/types";

interface Shot {
  uri: string;
  base64: string;
  width: number;
  height: number;
}

async function persistImage(id: string, index: number, shot: Shot): Promise<string> {
  if (Platform.OS === "web" || !FileSystem.documentDirectory) {
    return `data:image/jpeg;base64,${shot.base64}`;
  }
  const dir = `${FileSystem.documentDirectory}scans/`;
  try {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  } catch {}
  const dest = `${dir}${id}_${index}.jpg`;
  try {
    await FileSystem.copyAsync({ from: shot.uri, to: dest });
    return dest;
  } catch {
    return `data:image/jpeg;base64,${shot.base64}`;
  }
}

export default function Capture() {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const addHistory = useAddHistory();

  const [shots, setShots] = useState<Shot[]>([]);
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canUseCamera = Platform.OS !== "web" && permission?.granted;

  const capture = async () => {
    if (!cameraRef.current || busy) return;
    setBusy(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.5, base64: true });
      if (photo?.base64) {
        setShots((s) => [...s, { uri: photo.uri, base64: photo.base64!, width: photo.width, height: photo.height }]);
      }
    } catch {
      setError("Could not capture the photo. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const pickFromGallery = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        quality: 0.5,
        base64: true,
        selectionLimit: 6,
      });
      if (!res.canceled) {
        const next = res.assets
          .filter((a) => a.base64)
          .map((a) => ({ uri: a.uri, base64: a.base64!, width: a.width, height: a.height }));
        setShots((s) => [...s, ...next].slice(0, 6));
      }
    } catch {
      setError("Could not open the gallery.");
    }
  };

  const removeShot = (i: number) => setShots((s) => s.filter((_, idx) => idx !== i));

  const analyze = async () => {
    if (shots.length === 0) return;
    setAnalyzing(true);
    setError(null);
    try {
      const diagnosis = await api.analyze(shots.map((s) => s.base64));
      const id = `${Date.now()}`;
      const images = await Promise.all(shots.map((s, i) => persistImage(id, i, s)));
      const first = shots[0];
      const item: HistoryItem = {
        id,
        createdAt: Date.now(),
        date: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
        images,
        thumbnail: images[0],
        imageInfo: { name: "scan.jpg", resolution: `${first.width} x ${first.height}px` },
        diagnosis,
      };
      await addHistory.mutateAsync(item);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace({ pathname: "/result", params: { id } });
    } catch (e: any) {
      setError(e?.message || "Analysis failed. Please try again.");
      setAnalyzing(false);
    }
  };

  return (
    <View style={styles.root}>
      {/* Top bar */}
      <View style={[styles.topbar, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable style={styles.closeBtn} onPress={() => router.back()} testID="capture-close">
          <Ionicons name="close" size={26} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.topTitle}>New Scan</Text>
        <View style={{ width: 44 }} />
      </View>

      {/* Camera / permission / upload area */}
      {canUseCamera ? (
        <View style={styles.cameraWrap}>
          <CameraView ref={cameraRef} style={styles.camera} facing="back" />
          <View style={styles.overlay} pointerEvents="none">
            <View style={styles.frame}>
              <View style={[styles.corner, styles.tl]} />
              <View style={[styles.corner, styles.tr]} />
              <View style={[styles.corner, styles.bl]} />
              <View style={[styles.corner, styles.br]} />
            </View>
            <Text style={styles.hint}>Align the lesion within the frame</Text>
          </View>
        </View>
      ) : (
        <View style={styles.permWrap}>
          <View style={styles.permIcon}>
            <Ionicons name="camera-outline" size={40} color="#5C947A" />
          </View>
          <Text style={styles.permTitle}>
            {Platform.OS === "web" ? "Upload a photo" : "Camera access needed"}
          </Text>
          <Text style={styles.permText}>
            {Platform.OS === "web"
              ? "Choose a clear, well-lit close-up photo of the skin lesion from your device."
              : permission && !permission.canAskAgain
                ? "Enable camera access in Settings to take a photo, or upload one from your gallery."
                : "Take a clear, well-lit close-up photo of the skin lesion, or upload one from your gallery."}
          </Text>
          {Platform.OS !== "web" &&
            (permission && !permission.canAskAgain ? (
              <Button label="Open Settings" variant="secondary" onPress={() => Linking.openSettings()} testID="open-settings" style={{ marginTop: spacing.xl, alignSelf: "stretch" }} />
            ) : (
              <Button label="Enable Camera" onPress={requestPermission} testID="enable-camera" style={{ marginTop: spacing.xl, alignSelf: "stretch" }} />
            ))}
          <Button
            label="Upload from Gallery"
            variant={Platform.OS === "web" ? "primary" : "ghost"}
            onPress={pickFromGallery}
            testID="upload-gallery-alt"
            style={{ marginTop: spacing.md, alignSelf: "stretch" }}
          />
        </View>
      )}

      {/* Thumbnails */}
      {shots.length > 0 && (
        <View style={styles.thumbBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.lg }}>
            {shots.map((s, i) => (
              <View key={i} style={styles.thumbBox}>
                <Image source={{ uri: s.uri }} style={styles.thumbImg} contentFit="cover" />
                <Pressable style={styles.thumbRemove} onPress={() => removeShot(i)} testID={`remove-shot-${i}`}>
                  <Ionicons name="close" size={14} color="#FFFFFF" />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {error && <Text style={styles.error} testID="capture-error">{error}</Text>}

      {/* Bottom controls */}
      <View style={[styles.controls, { paddingBottom: insets.bottom + spacing.lg }]}>
        {shots.length > 0 ? (
          <Button
            label={`Analyze ${shots.length} Image${shots.length > 1 ? "s" : ""}`}
            onPress={analyze}
            testID="analyze-btn"
          />
        ) : canUseCamera ? (
          <View style={styles.shutterRow}>
            <Pressable style={styles.sideBtn} onPress={pickFromGallery} testID="gallery-btn">
              <Ionicons name="images-outline" size={26} color="#FFFFFF" />
            </Pressable>
            <Pressable style={styles.shutter} onPress={capture} disabled={busy} testID="shutter-btn">
              <View style={styles.shutterInner} />
            </Pressable>
            <View style={styles.sideBtn} />
          </View>
        ) : null}
      </View>

      {analyzing && (
        <View style={styles.analyzeOverlay} testID="analyzing-overlay">
          <View style={styles.scanLens}>
            <ActivityIndicator size="large" color="#5C947A" />
          </View>
          <Text style={styles.analyzeTitle}>Analyzing Image…</Text>
          <Text style={styles.analyzeSub}>AI is processing, please wait a moment.</Text>
        </View>
      )}
    </View>
  );
}

// Capture screen is intentionally dark regardless of theme for viewfinder contrast.
const useStyles = makeStyles(() => ({
  root: { flex: 1, backgroundColor: "#0A0D0B" },
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  closeBtn: { width: 44, height: 44, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.12)" },
  topTitle: { fontFamily: fonts.displaySemi, fontSize: fontSize.lg, color: "#FFFFFF" },
  cameraWrap: { flex: 1, margin: spacing.lg, borderRadius: radius.lg, overflow: "hidden", backgroundColor: "#000" },
  camera: { flex: 1 },
  overlay: { ...({ position: "absolute" } as const), top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  frame: { width: "70%", aspectRatio: 1, borderRadius: radius.md },
  corner: { position: "absolute", width: 34, height: 34, borderColor: "#5C947A" },
  tl: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: radius.md },
  tr: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: radius.md },
  bl: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: radius.md },
  br: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: radius.md },
  hint: { marginTop: spacing.xl, color: "#FFFFFF", fontFamily: fonts.bodyMedium, fontSize: fontSize.base, backgroundColor: "rgba(0,0,0,0.4)", paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill },
  permWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  permIcon: { width: 88, height: 88, borderRadius: radius.lg, backgroundColor: "rgba(92,148,122,0.15)", alignItems: "center", justifyContent: "center", marginBottom: spacing.lg },
  permTitle: { fontFamily: fonts.display, fontSize: fontSize.xl, color: "#FFFFFF", textAlign: "center" },
  permText: { fontFamily: fonts.body, fontSize: fontSize.base, color: "#8E9E96", textAlign: "center", marginTop: spacing.sm, lineHeight: 20 },
  thumbBar: { paddingVertical: spacing.md },
  thumbBox: { width: 72, height: 72, borderRadius: radius.md, overflow: "hidden" },
  thumbImg: { width: "100%", height: "100%" },
  thumbRemove: { position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  error: { color: "#E05A6B", fontFamily: fonts.bodyMedium, fontSize: fontSize.base, textAlign: "center", paddingHorizontal: spacing.xl, marginBottom: spacing.sm },
  controls: { paddingHorizontal: spacing.xl, paddingTop: spacing.md },
  shutterRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sideBtn: { width: 56, height: 56, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.12)" },
  shutter: { width: 78, height: 78, borderRadius: 39, borderWidth: 4, borderColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: "#FFFFFF" },
  analyzeOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(10,13,11,0.92)", alignItems: "center", justifyContent: "center" },
  scanLens: { width: 96, height: 96, borderRadius: 48, borderWidth: 3, borderColor: "#2B3831", alignItems: "center", justifyContent: "center", marginBottom: spacing.xl },
  analyzeTitle: { fontFamily: fonts.displaySemi, fontSize: fontSize.xl, color: "#FFFFFF" },
  analyzeSub: { fontFamily: fonts.body, fontSize: fontSize.base, color: "#8E9E96", marginTop: spacing.xs },
}));
