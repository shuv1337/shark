import { Hono } from "hono";

export const sshuvHandoffRoute = new Hono();

// Operator-approved receiver: SSHuv, signed by the same personal Apple team.
sshuvHandoffRoute.get("/.well-known/apple-app-site-association", (c) => {
  c.header("Cache-Control", "public, max-age=3600");
  c.header("X-Content-Type-Options", "nosniff");
  return c.json({
    applinks: {
      details: [
        {
          appIDs: ["7H54B326YZ.dev.shuv.sshuv"],
          components: [{ "/": "/conversation/v1/*" }],
        },
      ],
    },
  });
});

sshuvHandoffRoute.get("/conversation/v1/:reference", (c) => {
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Robots-Tag", "noindex, nofollow");
  c.header("X-Content-Type-Options", "nosniff");
  c.header(
    "Content-Security-Policy",
    "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  if (!/^[A-Za-z0-9_-]{75}$/.test(c.req.param("reference")) || new URL(c.req.url).search) {
    return c.text("Not found", 404);
  }
  // Never look up, echo, or log the reference. No account/session data is public,
  // and an absent app cannot turn this route into a redirect or agent action.
  return c.html(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Open SSHuv</title></head>
<body><main><h1>Open this conversation in SSHuv</h1><p>Open SSHuv and connect to your paired host to find your conversation.</p><p>If SSHuv is already installed, try opening the original link again from SHark. The link may have expired, or your host may be offline.</p><p>No conversation details are available on this page. Opening it does not send a message or approve a request.</p></main></body></html>`);
});
