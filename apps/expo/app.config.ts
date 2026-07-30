import type { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config: _config }: ConfigContext): ExpoConfig => {
  const easProjectId = process.env.EAS_PROJECT_ID?.trim();
  const appleTeamId = process.env.APPLE_TEAM_ID?.trim();
  if (process.env.EAS_BUILD_PROFILE && (!easProjectId || !appleTeamId)) {
    throw new Error("EAS builds require operator-owned EAS_PROJECT_ID and APPLE_TEAM_ID values.");
  }

  return {
    name: "SHark",
    slug: "shark-shuv",
    version: "1.0.0",
    icon: "./assets/icon.png",
    scheme: "shark",
    orientation: "portrait",
    userInterfaceStyle: "automatic",
    platforms: ["ios"],
    ios: {
      bundleIdentifier: "dev.shuv.shark",
      usesAppleSignIn: true,
      icon: "./assets/icon.png",
      supportsTablet: false,
      // Communication Notifications + SiriKit. EAS capability sync manages
      // aps-environment; signed artifacts remain the source of truth.
      entitlements: {
        "com.apple.developer.usernotifications.communication": true,
        "com.apple.developer.siri": true,
      },
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSUserActivityTypes: ["INSendMessageIntent"],
      },
    },
    plugins: [
      "./plugins/with-ios-scene-delegate",
      "expo-router",
      "expo-apple-authentication",
      "expo-secure-store",
      "expo-notifications",
      "expo-web-browser",
      [
        "expo-splash-screen",
        {
          backgroundColor: "#0C1119",
          image: "./assets/splash-icon.png",
          imageWidth: 200,
        },
      ],
      [
        "expo-build-properties",
        {
          ios: {
            deploymentTarget: "16.4",
          },
        },
      ],
      [
        "expo-widgets",
        {
          bundleIdentifier: "dev.shuv.shark.widgets",
          groupIdentifier: "group.dev.shuv.shark",
          enablePushNotifications: true,
          frequentUpdates: true,
        },
      ],
      [
        "@bacons/apple-targets",
        {
          appleTeamId: appleTeamId ?? "",
        },
      ],
    ],
    extra: easProjectId ? { eas: { projectId: easProjectId } } : {},
  };
};
