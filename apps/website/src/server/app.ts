import { type Context, Hono, type Next } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { auth } from "./auth";
import { env } from "./env";
import { databaseIsReady } from "./lib/readiness";
import { safeReturnPath } from "./lib/return-path";
import { beginAppleWebSignIn } from "./lib/web-sign-in";
import { verifyFirstPartyPass } from "./lib/web-view-session";
import { requireAuth } from "./middleware";
import { activitiesAgentRoute, activitiesSessionRoute } from "./routes/activities";
import { activityHooksRoute } from "./routes/activity-hooks";
import { apiTokensRoute } from "./routes/api-tokens";
import { appleAuthRoute } from "./routes/apple-auth";
import { appPassJwksRoute, appsAgentRoute, appsSessionRoute } from "./routes/apps";
import { billingRoute } from "./routes/billing";
import { boardAgentRoute } from "./routes/board-agent";
import { boardSessionRoute } from "./routes/board-session";
import { deviceAuthorizationRoute } from "./routes/device-authorization";
import { devicesRoute } from "./routes/devices";
import { docsTextRoute } from "./routes/docs";
import { eventsRoute } from "./routes/events";
import { hooksRoute } from "./routes/hooks";
import { inboxRoute } from "./routes/inbox";
import {
  agentRoute,
  interactionCredentialResponseRoute,
  interactionResponseRoute,
  liveActivityInteractionResponseRoute,
} from "./routes/interactions";
import { liveActivityRegistrationRoute } from "./routes/live-activity-registration";
import { macosRoute } from "./routes/macos";
import { servicesRoute } from "./routes/services";
import { watchRoute } from "./routes/watch";
import { webPushRoute } from "./routes/web-push";

export const app = new Hono();

/**
 * Logs requests without query strings and redacts webhook paths: `/hooks/:token`
 * embeds a plaintext credential that must never reach a log sink.
 */
async function accessLog(c: Context, next: Next): Promise<void> {
  const startedAt = Date.now();
  await next();
  const path = c.req.path.startsWith("/hooks/") ? "/hooks/:token" : c.req.path;
  console.log(`${c.req.method} ${path} ${c.res.status} ${Date.now() - startedAt}ms`);
}

// Bounds memory use for unauthenticated POST bodies; accepted payloads are far smaller.
app.use("*", bodyLimit({ maxSize: 64 * 1024 }));

if (process.env.NODE_ENV !== "test") {
  app.use("*", accessLog);
}

app.get("/api/health", (c) =>
  databaseIsReady() ? c.json({ ok: true }) : c.json({ ok: false }, 503),
);
app.get("/login", (c) =>
  beginAppleWebSignIn(auth.handler, env.APP_URL, safeReturnPath(c.req.query("next"), env.APP_URL)),
);
// The iPhone web view trades a pass for its own browser session; see web-view-session.ts.
app.post("/apps/enter", async (c) => {
  const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
  const pass = typeof form.pass === "string" ? form.pass : "";
  const userId = pass ? await verifyFirstPartyPass(pass) : null;
  c.header("Cache-Control", "no-store");
  if (!userId) return c.text("Sign-in pass is invalid or expired", 401);
  const { headers } = await auth.api.createWebViewSession({
    body: { userId },
    returnHeaders: true,
  });
  for (const cookie of headers.getSetCookie()) c.header("Set-Cookie", cookie, { append: true });
  const next = typeof form.next === "string" ? form.next : null;
  return c.redirect(safeReturnPath(next, env.APP_URL), 303);
});
app.get("/oss", requireAuth, (c) => c.redirect("https://github.com/shuv1337/shark/"));

// Mounted before the static handler in index.ts so the generated markdown wins
// over anything with the same name in dist/client.
app.route("/", docsTextRoute);
// Anonymous by design: web apps verify passes against these public keys.
app.route("/", appPassJwksRoute);

app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.route("/api/services", servicesRoute);
app.route("/api/api-tokens", apiTokensRoute);
app.route("/api/apple-auth", appleAuthRoute);
app.route("/api/device-authorization", deviceAuthorizationRoute);
app.route("/api/agent/activities", activitiesAgentRoute);
app.route("/api/agent/apps", appsAgentRoute);
app.route("/api/agent/board", boardAgentRoute);
app.route("/api/agent", agentRoute);
app.route("/api/watch", watchRoute);
app.route("/api/macos", macosRoute);
app.route("/api/activities", activitiesSessionRoute);
app.route("/api/apps", appsSessionRoute);
app.route("/api/board", boardSessionRoute);
app.route("/api/interactions", interactionResponseRoute);
app.route("/api/interaction-responses", interactionCredentialResponseRoute);
app.route("/api/live-activity-interactions", liveActivityInteractionResponseRoute);
app.route("/api/live-activity", liveActivityRegistrationRoute);
app.route("/api/billing", billingRoute);
app.route("/api/devices", devicesRoute);
app.route("/api/web-push", webPushRoute);
app.route("/api/events", eventsRoute);
app.route("/api/inbox", inboxRoute);
app.route("/hooks", activityHooksRoute);
app.route("/hooks", hooksRoute);

app.notFound((c) => {
  if (c.req.path.startsWith("/api") || c.req.path.startsWith("/hooks")) {
    return c.json({ error: "Not found" }, 404);
  }
  return c.text("Not found", 404);
});

app.onError((err, c) => {
  // Middleware rejections (for example the body-size limit) carry their own status.
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  return c.json({ error: "Internal server error" }, 500);
});
