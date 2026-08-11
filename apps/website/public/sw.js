self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data?.text() };
  }

  const title = typeof payload.title === "string" ? payload.title : "SHark";
  const options = {
    body: typeof payload.body === "string" ? payload.body : "You have a new SHark alert.",
    icon: "/app-store-icon.png",
    badge: "/favicon.png",
    data: { url: typeof payload.url === "string" ? payload.url : "/dashboard" },
  };
  if (typeof payload.imageUrl === "string") options.image = payload.imageUrl;
  if (typeof payload.tag === "string") options.tag = payload.tag;

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  let target = new URL("/dashboard", self.location.origin);
  try {
    const candidate = new URL(event.notification.data?.url || "/dashboard", self.location.origin);
    if (candidate.origin === self.location.origin && candidate.pathname === "/inbox") {
      candidate.pathname = "/dashboard";
    }
    if (candidate.protocol === "https:" || candidate.protocol === "http:") target = candidate;
  } catch {
    // Keep the safe dashboard fallback.
  }

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((client) => client.url === target.href);
      if (existing) return existing.focus();
      return clients.openWindow(target.href);
    }),
  );
});
