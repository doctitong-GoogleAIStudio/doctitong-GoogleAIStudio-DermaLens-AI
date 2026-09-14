import { useState } from "react";
import { View, Text, Modal, Pressable, TextInput, ScrollView } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/src/components/Button";
import { useAuth } from "@/src/auth";
import { useTheme, makeStyles, spacing, radius, fonts, fontSize } from "@/src/theme";

type Props = {
  visible: boolean;
  onClose: () => void;
  onDone?: () => void;
};

/**
 * Asked once when a device has a local session but no backend token (legacy
 * accounts, or a sign-in that happened offline). Re-authenticates the same
 * account so AI analysis works, instead of dead-ending the user.
 */
export function ReconnectSheet({ visible, onClose, onDone }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user, reconnect } = useAuth();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      await reconnect(password);
      setPassword("");
      onDone?.();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? "Could not enable AI analysis. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      onShow={() => {
        setPassword("");
        setError(null);
      }}
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior="padding" style={styles.wrap}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]} testID="reconnect-sheet">
            <Text style={styles.title}>Enable AI analysis</Text>
            <Text style={styles.hint}>
              Confirm the password for {user?.email ?? "your account"} once, while connected to the internet. Your
              scans stay on this phone.
            </Text>

            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Your password"
              placeholderTextColor={colors.muted}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="current-password"
              autoFocus
              onSubmitEditing={submit}
              testID="reconnect-password"
            />

            {!!error && (
              <Text style={styles.error} testID="reconnect-error">
                {error}
              </Text>
            )}

            <Button
              label="Enable AI analysis"
              onPress={submit}
              loading={busy}
              disabled={!password}
              testID="reconnect-submit"
              style={{ marginTop: spacing.lg }}
            />
            <Pressable style={styles.cancel} onPress={onClose} testID="reconnect-cancel">
              <Text style={styles.cancelText}>Not now</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)" },
  wrap: { flex: 1, justifyContent: "flex-end" },
  scroll: { flexGrow: 0, maxHeight: "90%" },
  scrollContent: { justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
  },
  title: { fontFamily: fonts.displaySemi, fontSize: fontSize.xl, color: colors.onSurface },
  hint: { fontFamily: fonts.body, fontSize: fontSize.base, color: colors.muted, marginTop: spacing.xs, lineHeight: 20 },
  input: {
    height: 54,
    marginTop: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
    paddingHorizontal: spacing.lg,
    fontFamily: fonts.body,
    fontSize: fontSize.lg,
    color: colors.onSurface,
  },
  error: { fontFamily: fonts.body, fontSize: fontSize.base, color: colors.error, marginTop: spacing.md },
  cancel: { alignItems: "center", paddingVertical: spacing.lg },
  cancelText: { fontFamily: fonts.bodySemi, fontSize: fontSize.base, color: colors.muted },
}));
