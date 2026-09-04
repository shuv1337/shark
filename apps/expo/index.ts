// TaskManager.defineTask must run from the JS entry before expo-router boots.
// Root layout is too late for a background wake after a force-quit.
import "./src/lib/notification-withdrawals";
import "expo-router/entry";
