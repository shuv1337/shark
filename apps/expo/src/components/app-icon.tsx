import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { fonts } from "../lib/theme";
import { fallbackTint } from "../lib/web-apps";

/** Rounded app tile: the registered icon, or a deterministic letter tile. */
export function AppIcon({
  name,
  iconUrl,
  size,
}: {
  name: string;
  iconUrl: string | null;
  size: number;
}) {
  const [failed, setFailed] = useState(false);
  const radius = Math.round(size * 0.27);
  if (iconUrl && !failed) {
    return (
      <Image
        accessibilityIgnoresInvertColors
        onError={() => setFailed(true)}
        source={{ uri: iconUrl }}
        style={[styles.tile, { width: size, height: size, borderRadius: radius }]}
      />
    );
  }
  const tint = fallbackTint(name);
  return (
    <View
      style={[
        styles.tile,
        styles.fallback,
        { width: size, height: size, borderRadius: radius, backgroundColor: tint.background },
      ]}
    >
      <Text style={[styles.letter, { color: tint.foreground, fontSize: Math.round(size * 0.4) }]}>
        {Array.from(name.trim())[0]?.toUpperCase() ?? "?"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flexShrink: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#0000001A",
  },
  fallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  letter: {
    fontFamily: fonts.semibold,
  },
});
