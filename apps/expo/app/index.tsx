import * as AppleAuthentication from "expo-apple-authentication";
import { Redirect } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { ActivityIndicator, Image, StyleSheet, Text, useColorScheme, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { signInWithApple } from "../src/lib/apple-auth";
import { useSession } from "../src/lib/auth";
import { isSimulatorPreview } from "../src/lib/inbox-preview";
import { colors, fonts, tightTracking } from "../src/lib/theme";

export default function SignInScreen() {
  const { data: session, isPending } = useSession();
  const [busy, setBusy] = useState<"apple" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const colorScheme = useColorScheme();

  // Keep the sign-in screen mounted until the native authorization code is
  // exchanged and its revocation token is safely stored server-side.
  if ((session || isSimulatorPreview) && busy !== "apple") return <Redirect href="/inbox" />;

  const continueWithApple = async () => {
    setBusy("apple");
    setError(null);
    try {
      await signInWithApple();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Apple sign-in failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="auto" />
      <View style={styles.header}>
        <Image
          accessible={false}
          source={require("../assets/splash-icon.png")}
          style={styles.brandMark}
        />
        <Text style={styles.brand}>SHark</Text>
      </View>

      <View style={styles.hero}>
        <Text style={styles.eyebrow}>Webhooks to iPhone</Text>
        <Text style={styles.title}>Let the important things find you.</Text>
        <Text style={styles.subtitle}>
          Sign in to receive source-branded notifications from every service you connect.
        </Text>
      </View>

      <View style={styles.footer}>
        {isPending ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <>
            <AppleAuthentication.AppleAuthenticationButton
              buttonStyle={
                colorScheme === "dark"
                  ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                  : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
              }
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
              cornerRadius={26}
              onPress={() => {
                if (!busy) void continueWithApple();
              }}
              style={[styles.appleButton, busy && styles.buttonDisabled]}
            />
            {busy === "apple" ? (
              <ActivityIndicator color={colors.appleButtonForeground} style={styles.appleSpinner} />
            ) : null}
          </>
        )}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
    backgroundColor: colors.paper,
  },
  header: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  brandMark: {
    width: 32,
    height: 32,
  },
  brand: {
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 18,
    letterSpacing: tightTracking(18),
  },
  hero: {
    flex: 1,
    alignItems: "flex-start",
    justifyContent: "center",
  },
  eyebrow: {
    marginBottom: 14,
    color: colors.accent,
    fontFamily: fonts.medium,
    fontSize: 12,
    letterSpacing: tightTracking(12),
    textTransform: "uppercase",
  },
  title: {
    maxWidth: 330,
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 40,
    lineHeight: 42,
    letterSpacing: tightTracking(40),
  },
  subtitle: {
    maxWidth: 330,
    marginTop: 20,
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 24,
    letterSpacing: tightTracking(16),
  },
  footer: {
    paddingBottom: 16,
    gap: 10,
  },
  appleButton: {
    width: "100%",
    height: 52,
  },
  appleSpinner: {
    position: "absolute",
    top: 17,
    alignSelf: "center",
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  error: {
    color: colors.danger,
    fontFamily: fonts.regular,
    fontSize: 13,
    letterSpacing: tightTracking(13),
  },
});
