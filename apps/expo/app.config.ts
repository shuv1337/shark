import type { ConfigContext, ExpoConfig } from "expo/config";

const SHARK_EAS_PROJECT_ID = "af59c084-62af-40bd-b679-2d05bafa4746";

export default ({ config: _config }: ConfigContext): ExpoConfig => {
  const configuredEasProjectId = process.env.EAS_PROJECT_ID?.trim();
  const appleTeamId = process.env.APPLE_TEAM_ID?.trim();
  if (configuredEasProjectId && configuredEasProjectId !== SHARK_EAS_PROJECT_ID) {
    throw new Error("EAS_PROJECT_ID must match SHark's operator-owned Expo project.");
  }
  if (process.env.EAS_BUILD_PROFILE && !appleTeamId) {
    throw new Error("EAS builds require an operator-owned APPLE_TEAM_ID value.");
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
      ...(appleTeamId ? { appleTeamId } : {}),
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
      [
        "expo-alternate-app-icons",
        [
          {
            name: "Teal",
            ios: "./assets/app-icons/teal.png",
            android: {
              foregroundImage: "./assets/app-icons/teal.png",
              backgroundColor: "#09606B",
            },
          },
          {
            name: "Blue",
            ios: "./assets/app-icons/blue.png",
            android: {
              foregroundImage: "./assets/app-icons/blue.png",
              backgroundColor: "#245493",
            },
          },
          {
            name: "Indigo",
            ios: "./assets/app-icons/indigo.png",
            android: {
              foregroundImage: "./assets/app-icons/indigo.png",
              backgroundColor: "#414781",
            },
          },
          {
            name: "Violet",
            ios: "./assets/app-icons/violet.png",
            android: {
              foregroundImage: "./assets/app-icons/violet.png",
              backgroundColor: "#66437D",
            },
          },
          {
            name: "Rose",
            ios: "./assets/app-icons/rose.png",
            android: {
              foregroundImage: "./assets/app-icons/rose.png",
              backgroundColor: "#84465F",
            },
          },
          {
            name: "Red",
            ios: "./assets/app-icons/red.png",
            android: {
              foregroundImage: "./assets/app-icons/red.png",
              backgroundColor: "#8D403D",
            },
          },
          {
            name: "Orange",
            ios: "./assets/app-icons/orange.png",
            android: {
              foregroundImage: "./assets/app-icons/orange.png",
              backgroundColor: "#925134",
            },
          },
          {
            name: "Gold",
            ios: "./assets/app-icons/gold.png",
            android: {
              foregroundImage: "./assets/app-icons/gold.png",
              backgroundColor: "#80651F",
            },
          },
          {
            name: "Black",
            ios: "./assets/app-icons/black.png",
            android: {
              foregroundImage: "./assets/app-icons/black.png",
              backgroundColor: "#292D2C",
            },
          },
        ],
      ],
      [
        "expo-notifications",
        {
          enableBackgroundRemoteNotifications: true,
        },
      ],
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
    extra: { eas: { projectId: SHARK_EAS_PROJECT_ID } },
  };
};
