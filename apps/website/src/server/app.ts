import { MCP_PATH } from "@hark/contracts";
import { APIError } from "better-auth/api";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { auth, TOKEN_RESPONSE_HEADERS } from "./auth";
import { env } from "./env";
import { accessLog } from "./lib/access-log";
import { trustedClientIp, withTrustedClientIp } from "./lib/client-ip";
import { OAUTH_TOKEN_ENDPOINT_PATH } from "./lib/oauth";
import { databaseIsReady } from "./lib/readiness";
import { safeReturnPath } from "./lib/return-path";
import { beginAppleWebSignIn } from "./lib/web-sign-in";
import { verifyFirstPartyPass, webViewEntryRefusal } from "./lib/web-view-session";
import { INTERNAL_AGENT_TOKEN, requireAuth } from "./middleware";
import { activitiesAgentRoute, activitiesSessionRoute } from "./routes/activities";
import { activityFeedAgentRoute, activityFeedRoute } from "./routes/activity-feed";
import { activityHooksRoute } from "./routes/activity-hooks";
import { agentOpenApiRoute } from "./routes/agent-openapi";
import { apiTokensAgentRoute, apiTokensRoute } from "./routes/api-tokens";
import { appleAuthRoute } from "./routes/apple-auth";
import { appPassJwksRoute, appsAgentRoute, appsSessionRoute } from "./routes/apps";
import { billingAgentRoute, billingRoute } from "./routes/billing";
import { boardAgentRoute } from "./routes/board-agent";
import { boardSessionRoute } from "./routes/board-session";
import { deviceAuthorizationRoute } from "./routes/device-authorization";
import { devicesAgentRoute, devicesRoute } from "./routes/devices";
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
import { createMcpRoute, MCP_MAX_BODY_BYTES } from "./routes/mcp";
import { oauthClientsRoute, oauthWellKnownRoute } from "./routes/oauth";
import {
  oncallAgentRoute,
  oncallSessionRoute,
  pageResponsesRoute,
  pagesAgentRoute,
  pagesSessionRoute,
} from "./routes/oncall";
import { inboxAgentRoute, inboxRoute as projectInboxRoute } from "./routes/project-inbox";
import { servicesAgentRoute, servicesRoute } from "./routes/services";
import { sshuvHandoffRoute } from "./routes/sshuv-handoff";
import { teamInvitesRoute, teamsAgentRoute, teamsSessionRoute } from "./routes/teams";
import { watchRoute } from "./routes/watch";
import { webPushRoute } from "./routes/web-push";

export const app = new Hono();

// Bounds memory use for unauthenticated POST bodies; accepted payloads are far smaller.
// MCP tool calls wrap agent payloads in JSON-RPC, so /mcp gets more headroom.
const defaultBodyLimit = bodyLimit({ maxSize: 64 * 1024 });
const mcpBodyLimit = bodyLimit({ maxSize: MCP_MAX_BODY_BYTES });
app.use("*", (c, next) => (c.req.path === MCP_PATH ? mcpBodyLimit : defaultBodyLimit)(c, next));

if (process.env.NODE_ENV !== "test") {
  app.use("*", accessLog);
}

app.get("/api/health", (c) =>
  databaseIsReady() ? c.json({ ok: true }) : c.json({ ok: false }, 503),
);
app.get("/login", (c) =>
  beginAppleWebSignIn(
    auth.handler,
    env.APP_URL,
    safeReturnPath(c.req.query("next"), env.APP_URL),
    trustedClientIp((name) => c.req.header(name)),
  ),
);
// The iPhone web view trades a pass for its own browser session; see web-view-session.ts.
app.post("/apps/enter", async (c) => {
  c.header("Cache-Control", "no-store");
  const refusal = webViewEntryRefusal(c.req.raw);
  if (refusal) {
    console.warn(`[apps/enter] refused reason=${refusal}`);
    return c.text("Forbidden", 403);
  }
  const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
  const pass = typeof form.pass === "string" ? form.pass : "";
  const userId = pass ? await verifyFirstPartyPass(pass) : null;
  if (!userId) return c.text("Sign-in pass is invalid or expired", 401);
  // The session-create hook refuses accounts that have left the email allowlist.
  const opened = await auth.api
    .createWebViewSession({ body: { userId }, returnHeaders: true })
    .catch((error: unknown) => {
      if (error instanceof APIError) return null;
      throw error;
    });
  if (!opened) {
    console.warn("[apps/enter] refused reason=session_denied");
    return c.text("Forbidden", 403);
  }
  const { headers } = opened;
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
app.route("/", sshuvHandoffRoute);

app.on(["GET", "POST"], "/api/auth/*", async (c) => {
  const response = await auth.handler(withTrustedClientIp(c.req.raw));
  // Better Auth sets these on successful token responses only; RFC 6749 wants them on errors too.
  if (c.req.path === OAUTH_TOKEN_ENDPOINT_PATH) {
    for (const [name, value] of Object.entries(TOKEN_RESPONSE_HEADERS)) {
      if (!response.headers.has(name)) response.headers.set(name, value);
    }
  }
  return response;
});
// OAuth discovery for the MCP server, and the server itself. Tool calls are
// dispatched through the agent routes below as the caller's grant token.
app.route("/", oauthWellKnownRoute);
app.route(
  "/",
  createMcpRoute(async (request, token) => app.fetch(request, { [INTERNAL_AGENT_TOKEN]: token })),
);
app.route("/api/oauth", oauthClientsRoute);

app.route("/api/services", servicesRoute);
app.route("/api/api-tokens", apiTokensRoute);
app.route("/api/apple-auth", appleAuthRoute);
app.route("/api/device-authorization", deviceAuthorizationRoute);
app.route("/api/agent/activities", activitiesAgentRoute);
app.route("/api/agent/apps", appsAgentRoute);
app.route("/api/agent/board", boardAgentRoute);
app.route("/api/agent/devices", devicesAgentRoute);
app.route("/api/agent/oncall", oncallAgentRoute);
app.route("/api/agent/pages", pagesAgentRoute);
app.route("/api/agent/services", servicesAgentRoute);
app.route("/api/agent/teams", teamsAgentRoute);
app.route("/api/agent/tokens", apiTokensAgentRoute);
app.route("/api/agent/billing", billingAgentRoute);
app.route("/api/agent/inbox", inboxAgentRoute);
app.route("/api/agent/activity-feed", activityFeedAgentRoute);
app.route("/api/agent", agentOpenApiRoute);
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
app.route("/api/teams", teamsSessionRoute);
app.route("/api/team-invites", teamInvitesRoute);
app.route("/api/oncall", oncallSessionRoute);
app.route("/api/pages", pagesSessionRoute);
app.route("/api/page-responses", pageResponsesRoute);
app.route("/api/devices", devicesRoute);
app.route("/api/web-push", webPushRoute);
app.route("/api/events", eventsRoute);
app.route("/api/inbox", projectInboxRoute);
app.route("/api/inbox", inboxRoute);
app.route("/api/activity-feed", activityFeedRoute);
app.route("/hooks", activityHooksRoute);
app.route("/hooks", hooksRoute);

app.notFound((c) => {
  if (
    c.req.path.startsWith("/api") ||
    c.req.path.startsWith("/hooks") ||
    c.req.path.startsWith("/.well-known/oauth")
  ) {
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
