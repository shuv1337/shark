import { Hono } from "hono";
import { getBilling } from "../lib/billing";
import { type AuthedEnv, requireAuth } from "../middleware";

/** Compatibility endpoint for existing clients; SHark has no checkout or plan catalog. */
export const billingRoute = new Hono<AuthedEnv>()
  .use("*", requireAuth)
  .get("/", async (c) => c.json(await getBilling(c.get("user"))));
