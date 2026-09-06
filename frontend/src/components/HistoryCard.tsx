import { View, Text, Pressable } from "react-native";
import { Image } from "expo-image";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import Ionicons from "@react-native-vector-icons/ionicons";
import * as Haptics from "expo-haptics";

import { useTheme, makeStyles, spacing, radius, fonts, fontSize } from "@/src/theme";
import type { HistoryItem } from "@/src/types";

function urgencyToken(colors: any, urgency: string) {
  const u = (urgency || "").toLowerCase();
  if (u.includes("urgent")) return colors.error;
  if (u.includes("prompt")) return colors.warning;
  return colors.success;
}

type Props = {
  item: HistoryItem;
  onPress: () => void;
  onDelete: () => void;
};

export function HistoryCard({ item, onPress, onDelete }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();

  const renderRightActions = () => (
    <Pressable
      style={styles.deleteAction}
      onPress={() => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onDelete();
      }}
      testID={`history-delete-${item.id}`}
    >
      <Ionicons name="trash-outline" size={22} color={colors.onError} />
      <Text style={styles.deleteText}>Delete</Text>
    </Pressable>
  );

  return (
    <ReanimatedSwipeable
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={renderRightActions}
      containerStyle={styles.swipeWrap}
    >
      <Pressable style={styles.card} onPress={onPress} testID={`history-item-${item.id}`}>
        <Image source={{ uri: item.thumbnail }} style={styles.thumb} contentFit="cover" />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardDate}>{item.date}</Text>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {item.diagnosis.mostLikelyDiagnosis.conditionName}
          </Text>
          <View style={styles.cardMeta}>
            <View
              style={[styles.dot, { backgroundColor: urgencyToken(colors, item.diagnosis.mostLikelyDiagnosis.urgency) }]}
            />
            <Text style={styles.cardMetaText}>{item.diagnosis.mostLikelyDiagnosis.urgency}</Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.muted} />
      </Pressable>
    </ReanimatedSwipeable>
  );
}

const useStyles = makeStyles((colors) => ({
  swipeWrap: { borderRadius: radius.lg, marginBottom: spacing.md, overflow: "hidden" },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  thumb: { width: 60, height: 60, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  cardDate: { fontFamily: fonts.body, fontSize: fontSize.sm, color: colors.muted },
  cardTitle: { fontFamily: fonts.bodySemi, fontSize: fontSize.lg, color: colors.onSurface, marginTop: 2 },
  cardMeta: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.xs },
  dot: { width: 8, height: 8, borderRadius: 4 },
  cardMetaText: { fontFamily: fonts.bodyMedium, fontSize: fontSize.sm, color: colors.muted },
  deleteAction: {
    width: 92,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    backgroundColor: colors.error,
  },
  deleteText: { fontFamily: fonts.bodySemi, fontSize: fontSize.sm, color: colors.onError },
}));
