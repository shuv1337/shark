import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import { user as userTable } from "../db/schema";
import { getBilling } from "../lib/billing";
import {
  type AgentEnv,
  type AuthedEnv,
  requireApiToken,
  requireAuth,
  requireScopes,
} from "../middleware";

/** Compatibility endpoint for existing clients; SHark has no checkout or plan catalog. */
export const billingRoute = new Hono<AuthedEnv>()
  .use("*", requireAuth)
  .get("/", async (c) => c.json(await getBilling(c.get("user"))));

export const billingAgentRoute = new Hono<AgentEnv>()
  .use("*", requireApiToken)
  .get("/", requireScopes("billing:read"), async (c) => {
    const [owner] = await db
      .select({ id: userTable.id, name: userTable.name, email: userTable.email })
      .from(userTable)
      .where(eq(userTable.id, c.get("apiToken").userId))
      .limit(1);
    if (!owner) return c.json({ error: "Account not found" }, 404);
    return c.json(await getBilling(owner));
  });
