import { useState } from "react";
import { View, Text, Modal, Pressable } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";

import { Button } from "@/src/components/Button";
import { Field } from "@/src/components/Field";
import { useTheme, makeStyles, spacing, radius, fonts, fontSize } from "@/src/theme";
import { HISTORY_FIELDS, type ClinicalHistory } from "@/src/types";

type Props = {
  visible: boolean;
  value: ClinicalHistory;
  /** Shown on the primary button, e.g. "Save & Continue" or "Save history". */
  saveLabel?: string;
  onClose: () => void;
  onSave: (history: ClinicalHistory) => void;
};

export function ClinicalHistorySheet({ visible, value, saveLabel = "Save history", onClose, onSave }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<ClinicalHistory>(value);

  const set = (key: keyof ClinicalHistory, text: string) => setDraft((d) => ({ ...d, [key]: text }));

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} onShow={() => setDraft(value)}>
      <View style={styles.root} testID="clinical-history-sheet">
        <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
          <Pressable style={styles.back} onPress={onClose} testID="history-close">
            <Ionicons name="close" size={24} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.headerTitle}>Symptoms & History</Text>
          <View style={{ width: 40 }} />
        </View>

        <KeyboardAwareScrollView
          contentContainerStyle={{ padding: spacing.xl, paddingBottom: insets.bottom + spacing["2xl"] }}
          bottomOffset={20}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.intro}>
            Every field is optional. Anything you add gives the AI more clinical context for its assessment.
          </Text>

          {HISTORY_FIELDS.map((f) => (
            <Field
              key={f.key}
              label={f.label}
              value={draft[f.key] ?? ""}
              onChangeText={(t) => set(f.key, t)}
              placeholder={f.placeholder}
              multiline={f.key === "notes" || f.key === "medicalHistory"}
              style={
                f.key === "notes" || f.key === "medicalHistory"
                  ? { height: 96, paddingTop: spacing.md, textAlignVertical: "top" }
                  : undefined
              }
              containerTestID={`history-field-${f.key}`}
            />
          ))}

          <Button label={saveLabel} onPress={() => onSave(draft)} testID="history-save" />
          <Pressable style={styles.skip} onPress={onClose} testID="history-skip">
            <Text style={styles.skipText}>Skip for now</Text>
          </Pressable>
        </KeyboardAwareScrollView>
      </View>
    </Modal>
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
  intro: {
    fontFamily: fonts.body,
    fontSize: fontSize.base,
    color: colors.muted,
    lineHeight: 20,
    marginBottom: spacing.xl,
  },
  skip: { alignItems: "center", paddingVertical: spacing.lg },
  skipText: { fontFamily: fonts.bodySemi, fontSize: fontSize.base, color: colors.muted },
}));
