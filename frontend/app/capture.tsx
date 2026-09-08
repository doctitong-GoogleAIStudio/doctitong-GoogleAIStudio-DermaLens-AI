import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Pressable, Platform, ActivityIndicator, ScrollView, Linking } from "react-native";
import { Image } from "expo-image";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import Ionicons from "@react-native-vector-icons/ionicons";

import { Button } from "@/src/components/Button";
import { ClinicalHistorySheet } from "@/src/components/ClinicalHistorySheet";
import { api } from "@/src/api";
import { useAddHistory, useUpdateHistory, readHistory } from "@/src/history";
import { makeStyles, spacing, radius, fonts, fontSize } from "@/src/theme";
import { HISTORY_FIELDS, type AssessmentMode, type ClinicalHistory, type HistoryItem } from "@/src/types";

const VIEW_LABELS = [
  "Main / front view",
  "Left-angle view",
  "Right-angle view",
  "Close-up",
  "Wider anatomical view",
  "Additional view",
];

const MAX_SHOTS = 6;
const MIN_SIDE = 300;
const MIN_BASE64 = 9000; // ~7KB of JPEG data — below this the photo carries almost no detail

interface Shot {
  uri: string;
  base64: string;
  width: number;
  height: number;
}

function qualityProblem(shot: Shot): string | null {
  if (shot.width && shot.height && (shot.width < MIN_SIDE || shot.height < MIN_SIDE)) {
    return "That photo is too small to assess. Please retake it closer to the lesion.";
  }
  if (shot.base64.length < MIN_BASE64) {
    return "That photo looks too dark or blurred to assess. Please retake it in better light, holding steady.";
  }
  return null;
}

async function persistImage(id: string, index: number, shot: Shot): Promise<string> {
  if (Platform.OS === "web" || !FileSystem.documentDirectory) {
    return `data:image/jpeg;base64,${shot.base64}`;
  }
  const dir = `${FileSystem.documentDirectory}scans/`;
  try {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  } catch {}
  const dest = `${dir}${id}_${index}_${Date.now()}.jpg`;
  try {
    await FileSystem.copyAsync({ from: shot.uri, to: dest });
    return dest;
  } catch {
    return `data:image/jpeg;base64,${shot.base64}`;
  }
}

/** Rebuilds an editable Shot from a stored image so a case can be re-analyzed. */
async function shotFromStored(uri: string): Promise<Shot | null> {
  try {
    if (uri.startsWith("data:")) {
      return { uri, base64: uri.split(",", 2)[1] ?? "", width: 0, height: 0 };
    }
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" });
    return { uri, base64, width: 0, height: 0 };
  } catch {
    return null;
  }
}

function historyCount(h: ClinicalHistory): number {
  return HISTORY_FIELDS.filter((f) => (h[f.key] ?? "").trim().length > 0).length;
}

export default function Capture() {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string; action?: string; caseId?: string; addHistory?: string }>();
  const mode: AssessmentMode = params.mode === "enhanced" ? "enhanced" : "quick";
  const caseId = typeof params.caseId === "string" ? params.caseId : undefined;

  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const addHistory = useAddHistory();
  const updateHistory = useUpdateHistory();

  const [shots, setShots] = useState<Shot[]>([]);
  const [clinicalHistory, setClinicalHistory] = useState<ClinicalHistory>({});
  const [historyOpen, setHistoryOpen] = useState(false);
  const [existing, setExisting] = useState<HistoryItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(params.action !== "upload");
  const kickedOff = useRef(false);

  const canUseCamera = Platform.OS !== "web" && permission?.granted;

  const addShots = useCallback((next: Shot[]) => {
    let rejected: string | null = null;
    const accepted = next.filter((s) => {
      const problem = qualityProblem(s);
      if (problem) {
        rejected = problem;
        return false;
      }
      return true;
    });
    setError(rejected);
    if (accepted.length) setShots((s) => [...s, ...accepted].slice(0, MAX_SHOTS));
  }, []);

  const pickFromGallery = useCallback(
    async (multiple: boolean) => {
      try {
        const res = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          allowsMultipleSelection: multiple,
          quality: 0.5,
          base64: true,
          selectionLimit: multiple ? MAX_SHOTS : 1,
        });
        if (!res.canceled) {
          addShots(
            res.assets
              .filter((a) => a.base64)
              .map((a) => ({ uri: a.uri, base64: a.base64!, width: a.width, height: a.height })),
          );
        }
      } catch {
        setError("Could not open the gallery.");
      }
    },
    [addShots],
  );

  // Load an existing case when re-analyzing, or auto-open the picker for "upload".
  useEffect(() => {
    if (kickedOff.current) return;
    kickedOff.current = true;
    (async () => {
      if (caseId) {
        const items = await readHistory();
        const item = items.find((i) => i.id === caseId) ?? null;
        setExisting(item);
        if (item) {
          setClinicalHistory(item.clinicalHistory ?? {});
          const loaded = await Promise.all(item.images.map(shotFromStored));
          setShots(loaded.filter((s): s is Shot => !!s && s.base64.length > 0));
          if (params.addHistory === "1") setHistoryOpen(true);
        }
        return;
      }
      if (params.action === "upload") pickFromGallery(mode === "enhanced");
    })();
  }, [caseId, mode, params.action, params.addHistory, pickFromGallery]);

  const capture = async () => {
    if (!cameraRef.current || busy) return;
    setBusy(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.5, base64: true });
      if (photo?.base64) {
        addShots([{ uri: photo.uri, base64: photo.base64, width: photo.width, height: photo.height }]);
        setCameraOpen(false);
      }
    } catch {
      setError("Could not capture the photo. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const removeShot = (i: number) => setShots((s) => s.filter((_, idx) => idx !== i));

  const analyze = async () => {
    if (shots.length === 0) return;
    setAnalyzing(true);
    setError(null);
    try {
      const filled: Record<string, string> = {};
      HISTORY_FIELDS.forEach((f) => {
        const v = (clinicalHistory[f.key] ?? "").trim();
        if (v) filled[f.key] = v;
      });
      const viewLabels = shots.length > 1 ? shots.map((_, i) => VIEW_LABELS[i] ?? "Additional view") : undefined;

      const diagnosis = await api.analyze(
        shots.map((s) => s.base64),
        { history: Object.keys(filled).length ? filled : undefined, viewLabels },
      );

      const id = existing?.id ?? `${Date.now()}`;
      const images = await Promise.all(shots.map((s, i) => persistImage(id, i, s)));
      const first = shots[0];
      const item: HistoryItem = {
        id,
        createdAt: existing?.createdAt ?? Date.now(),
        date:
          existing?.date ??
          new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
        images,
        thumbnail: images[0],
        imageInfo: {
          name: shots.length > 1 ? `${shots.length} photos` : "scan.jpg",
          resolution: first.width ? `${first.width} x ${first.height}px` : (existing?.imageInfo?.resolution ?? "—"),
        },
        note: existing?.note,
        mode: shots.length > 1 || Object.keys(filled).length ? "enhanced" : mode,
        viewLabels,
        clinicalHistory: Object.keys(filled).length ? (filled as ClinicalHistory) : undefined,
        diagnosis,
      };

      if (existing) await updateHistory.mutateAsync(item);
      else await addHistory.mutateAsync(item);

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace({ pathname: "/result", params: { id } });
    } catch (e: any) {
      setError(e?.message || "Analysis failed. Please try again.");
      setAnalyzing(false);
    }
  };

  const hCount = historyCount(clinicalHistory);
  const showCamera = cameraOpen && canUseCamera && shots.length < MAX_SHOTS;

  return (
    <View style={styles.root}>
      {/* Top bar */}
      <View style={[styles.topbar, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable style={styles.closeBtn} onPress={() => router.back()} testID="capture-close">
          <Ionicons name="close" size={26} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.topTitle}>
          {existing ? "Re-analyze Case" : mode === "enhanced" ? "Enhanced Analysis" : "Quick Analysis"}
        </Text>
        <View style={{ width: 44 }} />
      </View>

      {showCamera ? (
        <View style={styles.cameraWrap}>
          <CameraView ref={cameraRef} style={styles.camera} facing="back" />
          <View style={styles.overlay} pointerEvents="none">
            <View style={styles.frame}>
              <View style={[styles.corner, styles.tl]} />
              <View style={[styles.corner, styles.tr]} />
              <View style={[styles.corner, styles.bl]} />
              <View style={[styles.corner, styles.br]} />
            </View>
            <Text style={styles.hint}>
              {mode === "enhanced" && shots.length > 0
                ? `Next: ${VIEW_LABELS[shots.length] ?? "another view"}`
                : "Align the lesion within the frame"}
            </Text>
          </View>
        </View>
      ) : shots.length === 0 ? (
        <View style={styles.permWrap}>
          <View style={styles.permIcon}>
            <Ionicons name="camera-outline" size={40} color="#5C947A" />
          </View>
          <Text style={styles.permTitle}>
            {Platform.OS === "web" ? "Upload a photo" : canUseCamera ? "Ready when you are" : "Camera access needed"}
          </Text>
          <Text style={styles.permText}>
            {Platform.OS === "web"
              ? "Choose a clear, well-lit close-up photo of the skin lesion from your device."
              : permission && !permission.canAskAgain
                ? "Enable camera access in Settings to take a photo, or upload one from your gallery."
                : "Take a clear, well-lit close-up photo of the skin lesion, or upload one from your gallery."}
          </Text>
          {Platform.OS !== "web" &&
            (canUseCamera ? (
              <Button
                label="Open Camera"
                onPress={() => setCameraOpen(true)}
                testID="open-camera"
                style={{ marginTop: spacing.xl, alignSelf: "stretch" }}
              />
            ) : permission && !permission.canAskAgain ? (
              <Button
                label="Open Settings"
                variant="secondary"
                onPress={() => Linking.openSettings()}
                testID="open-settings"
                style={{ marginTop: spacing.xl, alignSelf: "stretch" }}
              />
            ) : (
              <Button
                label="Enable Camera"
                onPress={requestPermission}
                testID="enable-camera"
                style={{ marginTop: spacing.xl, alignSelf: "stretch" }}
              />
            ))}
          <Button
            label="Upload from Gallery"
            variant={Platform.OS === "web" ? "primary" : "ghost"}
            onPress={() => pickFromGallery(mode === "enhanced")}
            testID="upload-gallery-alt"
            style={{ marginTop: spacing.md, alignSelf: "stretch" }}
          />
        </View>
      ) : (
        /* Review / improve step */
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing.lg }}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.reviewTitle} testID="improve-title">
            Want to improve the assessment?
          </Text>
          <Text style={styles.reviewText}>
            Adding more views and information about the lesion can give the AI additional context. Both are optional.
          </Text>

          <View style={styles.summary}>
            <View style={styles.summaryRow}>
              <Ionicons name="images-outline" size={18} color="#5C947A" />
              <Text style={styles.summaryText}>
                {shots.length} photo{shots.length > 1 ? "s" : ""} ready
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Ionicons name="document-text-outline" size={18} color="#5C947A" />
              <Text style={styles.summaryText} testID="history-summary">
                {hCount > 0 ? `${hCount} history detail${hCount > 1 ? "s" : ""} added` : "No symptoms or history yet"}
              </Text>
            </View>
          </View>

          {Platform.OS !== "web" && shots.length < MAX_SHOTS && (
            <Button
              label="Add More Photos"
              variant="secondary"
              onPress={() => setCameraOpen(true)}
              testID="add-more-photos"
              style={{ marginTop: spacing.lg }}
            />
          )}
          {shots.length < MAX_SHOTS && (
            <Button
              label={Platform.OS === "web" ? "Add More Photos" : "Upload More Photos"}
              variant={Platform.OS === "web" ? "secondary" : "ghost"}
              onPress={() => pickFromGallery(true)}
              testID="add-more-upload"
              style={{ marginTop: spacing.md }}
            />
          )}
          <Button
            label={hCount > 0 ? "Edit Symptoms & History" : "Add Symptoms & History"}
            variant="ghost"
            onPress={() => setHistoryOpen(true)}
            testID="add-history"
            style={{ marginTop: spacing.md }}
          />
        </ScrollView>
      )}

      {/* Thumbnails */}
      {shots.length > 0 && (
        <View style={styles.thumbBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.lg }}
          >
            {shots.map((s, i) => (
              <View key={`${s.uri}-${i}`} style={styles.thumbCol}>
                <View style={styles.thumbBox}>
                  <Image source={{ uri: s.uri }} style={styles.thumbImg} contentFit="cover" />
                  <Pressable style={styles.thumbRemove} onPress={() => removeShot(i)} testID={`remove-shot-${i}`}>
                    <Ionicons name="close" size={14} color="#FFFFFF" />
                  </Pressable>
                </View>
                {shots.length > 1 && (
                  <Text style={styles.thumbLabel} numberOfLines={1} testID={`shot-label-${i}`}>
                    {VIEW_LABELS[i] ?? "Additional"}
                  </Text>
                )}
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {error && (
        <Text style={styles.error} testID="capture-error">
          {error}
        </Text>
      )}

      {/* Bottom controls */}
      <View style={[styles.controls, { paddingBottom: insets.bottom + spacing.lg }]}>
        {showCamera ? (
          <View style={styles.shutterRow}>
            <Pressable style={styles.sideBtn} onPress={() => pickFromGallery(mode === "enhanced")} testID="gallery-btn">
              <Ionicons name="images-outline" size={26} color="#FFFFFF" />
            </Pressable>
            <Pressable style={styles.shutter} onPress={capture} disabled={busy} testID="shutter-btn">
              <View style={styles.shutterInner} />
            </Pressable>
            {shots.length > 0 ? (
              <Pressable style={styles.sideBtn} onPress={() => setCameraOpen(false)} testID="done-capturing">
                <Ionicons name="checkmark" size={26} color="#FFFFFF" />
              </Pressable>
            ) : (
              <View style={styles.sideBtn} />
            )}
          </View>
        ) : shots.length > 0 ? (
          <Button
            label={existing ? "Re-analyze Now" : hCount > 0 || shots.length > 1 ? "Analyze Now" : "Skip & Analyze"}
            onPress={analyze}
            testID="analyze-btn"
          />
        ) : null}
      </View>

      {analyzing && (
        <View style={styles.analyzeOverlay} testID="analyzing-overlay">
          <View style={styles.scanLens}>
            <ActivityIndicator size="large" color="#5C947A" />
          </View>
          <Text style={styles.analyzeTitle}>
            {shots.length > 1 ? `Analyzing ${shots.length} Images…` : "Analyzing Image…"}
          </Text>
          <Text style={styles.analyzeSub}>AI is processing, please wait a moment.</Text>
        </View>
      )}

      <ClinicalHistorySheet
        visible={historyOpen}
        value={clinicalHistory}
        saveLabel="Save history"
        onClose={() => setHistoryOpen(false)}
        onSave={(h) => {
          setClinicalHistory(h);
          setHistoryOpen(false);
        }}
      />
    </View>
  );
}

// Capture screen is intentionally dark regardless of theme for viewfinder contrast.
const useStyles = makeStyles(() => ({
  root: { flex: 1, backgroundColor: "#0A0D0B" },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  topTitle: { fontFamily: fonts.displaySemi, fontSize: fontSize.lg, color: "#FFFFFF" },
  cameraWrap: { flex: 1, margin: spacing.lg, borderRadius: radius.lg, overflow: "hidden", backgroundColor: "#000" },
  camera: { flex: 1 },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  frame: { width: "70%", aspectRatio: 1, borderRadius: radius.md },
  corner: { position: "absolute", width: 34, height: 34, borderColor: "#5C947A" },
  tl: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: radius.md },
  tr: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: radius.md },
  bl: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: radius.md },
  br: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: radius.md },
  hint: {
    marginTop: spacing.xl,
    color: "#FFFFFF",
    fontFamily: fonts.bodyMedium,
    fontSize: fontSize.base,
    backgroundColor: "rgba(0,0,0,0.4)",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  permWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  permIcon: {
    width: 88,
    height: 88,
    borderRadius: radius.lg,
    backgroundColor: "rgba(92,148,122,0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  permTitle: { fontFamily: fonts.display, fontSize: fontSize.xl, color: "#FFFFFF", textAlign: "center" },
  permText: {
    fontFamily: fonts.body,
    fontSize: fontSize.base,
    color: "#8E9E96",
    textAlign: "center",
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  reviewTitle: { fontFamily: fonts.display, fontSize: fontSize["2xl"], color: "#FFFFFF" },
  reviewText: {
    fontFamily: fonts.body,
    fontSize: fontSize.base,
    color: "#8E9E96",
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  summary: {
    marginTop: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.06)",
    padding: spacing.lg,
    gap: spacing.sm,
  },
  summaryRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  summaryText: { fontFamily: fonts.bodyMedium, fontSize: fontSize.base, color: "#FFFFFF" },
  thumbBar: { paddingVertical: spacing.md },
  thumbCol: { width: 72, alignItems: "center" },
  thumbBox: { width: 72, height: 72, borderRadius: radius.md, overflow: "hidden" },
  thumbImg: { width: "100%", height: "100%" },
  thumbRemove: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  thumbLabel: { fontFamily: fonts.body, fontSize: 10, color: "#8E9E96", marginTop: 4 },
  error: {
    color: "#E05A6B",
    fontFamily: fonts.bodyMedium,
    fontSize: fontSize.base,
    textAlign: "center",
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.sm,
  },
  controls: { paddingHorizontal: spacing.xl, paddingTop: spacing.md },
  shutterRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sideBtn: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  shutter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: "#FFFFFF" },
  analyzeOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(10,13,11,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  scanLens: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 3,
    borderColor: "#2B3831",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xl,
  },
  analyzeTitle: { fontFamily: fonts.displaySemi, fontSize: fontSize.xl, color: "#FFFFFF" },
  analyzeSub: { fontFamily: fonts.body, fontSize: fontSize.base, color: "#8E9E96", marginTop: spacing.xs },
}));
