import { useState } from "react";
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";

import { Button } from "@/src/components/Button";
import { exportBackup, importBackup, type BackupProgress } from "@/src/backup";
import { historyQueryKey, useHistory } from "@/src/history";
import { useTheme, makeStyles, spacing, radius, fonts, fontSize } from "@/src/theme";

const MIN_PASSWORD = 8;

export default function Backup() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: history } = useHistory();

  const [mode, setMode] = useState<"export" | "restore">("export");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const scans = history?.length ?? 0;
  const onProgress = (p: BackupProgress) => setProgress(p);

  const reset = (next: "export" | "restore") => {
    setMode(next);
    setPassword("");
    setConfirm("");
    setError(null);
    setDone(null);
    setProgress(null);
  };

  const runExport = async () => {
    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters for the backup password.`);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await exportBackup(password, onProgress);
      setDone(
        `Saved ${res.fileName} — ${res.scans} scan${res.scans === 1 ? "" : "s"} and ${res.photos} photo${
          res.photos === 1 ? "" : "s"
        }.${res.missingPhotos ? ` ${res.missingPhotos} photo(s) were no longer on the phone.` : ""}`,
      );
      setPassword("");
      setConfirm("");
    } catch (e: any) {
      setError(e?.message ?? "The backup could not be created.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const runImport = async () => {
    if (!password) {
      setError("Enter the password you used for this backup.");
      return;
    }
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await importBackup(password, onProgress);
      if (!res) return; // cancelled
      qc.invalidateQueries({ queryKey: historyQueryKey });
      setDone(`Restored ${res.scans} scan${res.scans === 1 ? "" : "s"} — ${res.added} new, ${res.updated} updated.`);
      setPassword("");
    } catch (e: any) {
      setError(e?.message ?? "The backup could not be restored.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable
          style={styles.back}
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)"))}
          testID="backup-back"
        >
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Backup & restore</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ padding: spacing.xl, paddingBottom: insets.bottom + spacing["2xl"] }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.tabs}>
            <Pressable
              style={[styles.tab, mode === "export" && styles.tabActive]}
              onPress={() => reset("export")}
              testID="backup-tab-export"
            >
              <Text style={[styles.tabText, mode === "export" && styles.tabTextActive]}>Export</Text>
            </Pressable>
            <Pressable
              style={[styles.tab, mode === "restore" && styles.tabActive]}
              onPress={() => reset("restore")}
              testID="backup-tab-restore"
            >
              <Text style={[styles.tabText, mode === "restore" && styles.tabTextActive]}>Restore</Text>
            </Pressable>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Ionicons name="lock-closed" size={18} color={colors.brandPrimary} />
              <Text style={styles.cardTitle}>Always encrypted</Text>
            </View>
            <Text style={styles.cardText}>
              {mode === "export"
                ? `Your ${scans} scan${scans === 1 ? "" : "s"} and their photos are packed into one file and locked with a password you choose. Keep the password safe — without it the file cannot be opened, not even by us.`
                : "Pick a backup file and enter the password it was created with. Restored scans are added to this phone; a scan you already have is replaced by the one in the file."}
            </Text>
          </View>

          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder={mode === "export" ? "Backup password" : "Password for this backup"}
            placeholderTextColor={colors.muted}
            secureTextEntry
            autoCapitalize="none"
            testID="backup-password"
          />

          {mode === "export" && (
            <TextInput
              style={styles.input}
              value={confirm}
              onChangeText={setConfirm}
              placeholder="Repeat password"
              placeholderTextColor={colors.muted}
              secureTextEntry
              autoCapitalize="none"
              testID="backup-password-confirm"
            />
          )}

          {!!progress && (
            <View style={styles.progress} testID="backup-progress">
              <ActivityIndicator color={colors.brandPrimary} />
              <Text style={styles.progressText}>
                {progress.step} {progress.total > 1 ? `${progress.done}/${progress.total}` : ""}
              </Text>
            </View>
          )}

          {!!error && (
            <Text style={styles.error} testID="backup-error">
              {error}
            </Text>
          )}
          {!!done && (
            <Text style={styles.success} testID="backup-success">
              {done}
            </Text>
          )}

          <Button
            label={mode === "export" ? "Create backup file" : "Choose file & restore"}
            onPress={mode === "export" ? runExport : runImport}
            loading={busy}
            disabled={mode === "export" && scans === 0}
            testID="backup-submit"
            style={{ marginTop: spacing.lg }}
          />

          {mode === "export" && scans === 0 && (
            <Text style={styles.hint}>Run your first analysis and there will be something to back up.</Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceTertiary,
  },
  headerTitle: { fontFamily: fonts.displaySemi, fontSize: fontSize.lg, color: colors.onSurface },
  tabs: {
    flexDirection: "row",
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    padding: 4,
    marginBottom: spacing.xl,
  },
  tab: { flex: 1, alignItems: "center", paddingVertical: spacing.md, borderRadius: radius.sm },
  tabActive: { backgroundColor: colors.surface },
  tabText: { fontFamily: fonts.bodySemi, fontSize: fontSize.base, color: colors.muted },
  tabTextActive: { color: colors.onSurface },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  cardTitle: { fontFamily: fonts.bodySemi, fontSize: fontSize.base, color: colors.onSurface },
  cardText: { fontFamily: fonts.body, fontSize: fontSize.base, color: colors.onSurfaceSecondary, lineHeight: 20 },
  input: {
    height: 54,
    marginBottom: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
    paddingHorizontal: spacing.lg,
    fontFamily: fonts.body,
    fontSize: fontSize.lg,
    color: colors.onSurface,
  },
  progress: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.sm },
  progressText: { fontFamily: fonts.body, fontSize: fontSize.base, color: colors.onSurfaceSecondary },
  error: { fontFamily: fonts.body, fontSize: fontSize.base, color: colors.error, marginTop: spacing.md },
  success: { fontFamily: fonts.body, fontSize: fontSize.base, color: colors.success, marginTop: spacing.md },
  hint: {
    fontFamily: fonts.body,
    fontSize: fontSize.sm,
    color: colors.muted,
    textAlign: "center",
    marginTop: spacing.md,
  },
}));
