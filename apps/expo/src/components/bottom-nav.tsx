import { usePathname, useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, fonts, tightTracking } from "../lib/theme";

const destinations = [
  { path: "/inbox", label: "Inbox", icon: "tray.full" },
  { path: "/home", label: "Device", icon: "iphone" },
  { path: "/settings", label: "Settings", icon: "gearshape" },
] as const;

export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  return (
    <View style={styles.bar}>
      {destinations.map((destination) => {
        const selected = pathname === destination.path;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={destination.path}
            onPress={() => router.replace(destination.path)}
            style={({ pressed }) => [styles.item, pressed && styles.pressed]}
          >
            <SymbolView
              name={destination.icon}
              size={20}
              tintColor={selected ? colors.accent : colors.soft}
              weight={selected ? "semibold" : "regular"}
            />
            <Text style={[styles.label, selected && styles.labelSelected]}>
              {destination.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    minHeight: 66,
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    backgroundColor: colors.surface,
  },
  item: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  pressed: { opacity: 0.62 },
  label: {
    color: colors.soft,
    fontFamily: fonts.medium,
    fontSize: 10,
    letterSpacing: tightTracking(10),
  },
  labelSelected: { color: colors.accent },
});
