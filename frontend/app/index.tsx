import { View, ActivityIndicator, Text } from "react-native";

import { makeStyles, useTheme, fonts, fontSize, spacing } from "@/src/theme";

export default function Index() {
  const styles = useStyles();
  const { colors } = useTheme();

  return (
    <View style={styles.container} testID="bootstrap-screen">
      <Text style={styles.brand}>DermaLens AI</Text>
      <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.lg }} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  brand: { fontFamily: fonts.display, fontSize: fontSize["2xl"], color: colors.brandPrimary },
}));
