import { useState } from "react";
import { View, Text, Modal, Pressable, TextInput } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/src/components/Button";
import { useTheme, makeStyles, spacing, radius, fonts, fontSize } from "@/src/theme";

const MAX = 280;

type Props = {
  visible: boolean;
  value?: string;
  onClose: () => void;
  onSave: (note: string) => void;
};

export function NoteSheet({ visible, value, onClose, onSave }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(value ?? "");

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} onShow={() => setDraft(value ?? "")}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior="padding" style={styles.wrap}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]} testID="note-sheet">
          <Text style={styles.title}>Note for this scan</Text>
          <Text style={styles.hint}>Add anything you noticed — e.g. “itchy for 2 weeks”.</Text>

          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={(t) => setDraft(t.slice(0, MAX))}
            placeholder="Itchy for 2 weeks, slowly getting darker…"
            placeholderTextColor={colors.muted}
            multiline
            autoFocus
            textAlignVertical="top"
            testID="note-input"
          />
          <Text style={styles.count}>
            {draft.length}/{MAX}
          </Text>

          <Button label="Save note" onPress={() => onSave(draft.trim())} testID="note-save" />
          <Pressable style={styles.cancel} onPress={onClose} testID="note-cancel">
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)" },
  wrap: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
  },
  title: { fontFamily: fonts.displaySemi, fontSize: fontSize.xl, color: colors.onSurface },
  hint: { fontFamily: fonts.body, fontSize: fontSize.base, color: colors.muted, marginTop: 2 },
  input: {
    minHeight: 110,
    marginTop: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontFamily: fonts.body,
    fontSize: fontSize.lg,
    color: colors.onSurface,
  },
  count: {
    fontFamily: fonts.body,
    fontSize: fontSize.sm,
    color: colors.muted,
    textAlign: "right",
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  cancel: { alignItems: "center", paddingVertical: spacing.md, marginTop: spacing.xs },
  cancelText: { fontFamily: fonts.bodySemi, fontSize: fontSize.base, color: colors.muted },
}));
