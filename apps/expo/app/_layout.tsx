import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  useFonts,
} from "@expo-google-fonts/inter";
import * as Notifications from "expo-notifications";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { AppState } from "react-native";
import { useSession } from "../src/lib/auth";
import {
  flushInteractionResponses,
  handleNotificationResponse,
  registerInteractionCategories,
} from "../src/lib/interactions";
import { startLiveActivityTokenSync } from "../src/lib/live-activities";
import { setNotificationDetail } from "../src/lib/notification-detail";
import { colors } from "../src/lib/theme";

void SplashScreen.preventAutoHideAsync();
void registerInteractionCategories().catch((error) => {
  console.warn("Could not register notification actions", error);
});

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function RootLayout() {
  const { data: session } = useSession();
  const router = useRouter();
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) void SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    const handleResponse = (response: Notifications.NotificationResponse) => {
      void handleNotificationResponse(response, (detail) => {
        setNotificationDetail(detail);
        router.push("/notification-detail");
      });
    };
    // Handle both a cold launch from a notification and taps while the app is running.
    const initialResponse = Notifications.getLastNotificationResponse();
    if (initialResponse) {
      handleResponse(initialResponse);
      void Notifications.clearLastNotificationResponseAsync();
    }
    void flushInteractionResponses();

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      handleResponse(response);
    });
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") void flushInteractionResponses();
    });
    const retryTimer = setInterval(() => void flushInteractionResponses(), 30_000);
    return () => {
      subscription.remove();
      appState.remove();
      clearInterval(retryTimer);
    };
  }, [router]);

  useEffect(() => {
    if (!session) return;
    return startLiveActivityTokenSync();
  }, [session]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.paper },
      }}
    />
  );
}
