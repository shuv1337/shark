import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  useFonts,
} from "@expo-google-fonts/inter";
import * as Notifications from "expo-notifications";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useSession } from "../src/lib/auth";
import { inboxIdFromNotificationData } from "../src/lib/inbox";
import {
  flushInteractionResponses,
  handleNotificationResponse,
  registerInteractionCategories,
} from "../src/lib/interactions";
import { startLiveActivityTokenSync } from "../src/lib/live-activities";
import { setNotificationDetail } from "../src/lib/notification-detail";
import { createNotificationResponseHandler } from "../src/lib/notification-response-handler";
import {
  dismissNotificationsForEvent,
  withdrawalEventId,
} from "../src/lib/notification-withdrawals";
import { colors } from "../src/lib/theme";

void SplashScreen.preventAutoHideAsync();
void registerInteractionCategories().catch((error) => {
  console.warn("Could not register notification actions", error);
});

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const eventId = withdrawalEventId(notification.request.content.data);
    if (eventId) {
      await dismissNotificationsForEvent(eventId);
      return {
        shouldShowBanner: false,
        shouldShowList: false,
        shouldPlaySound: false,
        shouldSetBadge: false,
      };
    }
    return {
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    };
  },
});

export default function RootLayout() {
  const { data: session } = useSession();
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const responseHandler = useRef<ReturnType<typeof createNotificationResponseHandler> | null>(null);
  if (!responseHandler.current) {
    responseHandler.current = createNotificationResponseHandler(async (response) => {
      const inboxId = inboxIdFromNotificationData(response.notification.request.content.data);
      await handleNotificationResponse(response, (detail) => {
        if (inboxId) {
          routerRef.current.push({ pathname: "/inbox-detail", params: { id: inboxId } });
          return;
        }
        setNotificationDetail(detail);
        routerRef.current.push("/notification-detail");
      });
    });
  }
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
      void responseHandler.current?.(response).catch(() => {});
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
  }, []);

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
