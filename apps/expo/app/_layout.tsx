import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  useFonts,
} from "@expo-google-fonts/inter";
import * as Notifications from "expo-notifications";
import { Stack, useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useSession } from "../src/lib/auth";
import { inboxIdFromNotificationData } from "../src/lib/inbox";
import {
  flushInteractionResponses,
  flushPageAcknowledgements,
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
import { PENDING_JOIN_CODE_KEY } from "../src/lib/teams";
import { colors } from "../src/lib/theme";
import { webAppFromNotificationData } from "../src/lib/web-apps";

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
      const data = response.notification.request.content.data;
      const inboxId = inboxIdFromNotificationData(data);
      const webApp = webAppFromNotificationData(data);
      await handleNotificationResponse(response, (detail) => {
        // App notifications open inside SHark, signed in; the web view only
        // honors `url` when it belongs to the app origin.
        if (webApp) {
          routerRef.current.push({
            pathname: "/web/[id]",
            params: { id: webApp.appId, ...(webApp.url ? { url: webApp.url } : {}) },
          });
          return;
        }
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
    void flushPageAcknowledgements();

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      handleResponse(response);
    });
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void flushInteractionResponses();
        void flushPageAcknowledgements();
      }
    });
    const retryTimer = setInterval(() => {
      void flushInteractionResponses();
      void flushPageAcknowledgements();
    }, 30_000);
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

  // An invite opened while signed out resumes once sign-in completes.
  const signedIn = Boolean(session);
  useEffect(() => {
    if (!signedIn) return;
    void SecureStore.getItemAsync(PENDING_JOIN_CODE_KEY).then(async (code) => {
      if (!code) return;
      await SecureStore.deleteItemAsync(PENDING_JOIN_CODE_KEY);
      setTimeout(() => {
        try {
          routerRef.current.push({ pathname: "/join/[code]", params: { code } });
        } catch {
          // The invite link can be opened again.
        }
      }, 600);
    });
  }, [signedIn]);

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
