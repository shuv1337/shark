import {
  type AgentServiceDto,
  type ServiceCreatedResponse,
  type ServiceCreateInput,
  type ServiceDto,
  type ServiceUpdateInput,
  serviceCreateSchema,
  serviceUpdateSchema,
} from "@hark/contracts";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import { service } from "../db/schema";
import { env } from "../env";
import { newId } from "../lib/id";
import { syncInboxForUser } from "../lib/inbox";
import {
  decryptWebhookToken,
  encryptWebhookToken,
  generateWebhookToken,
  hashWebhookToken,
} from "../lib/token";
import {
  type AgentEnv,
  type AuthedEnv,
  requireApiToken,
  requireAuth,
  requireScopes,
} from "../middleware";

export function serviceToDto(row: typeof service.$inferSelect): ServiceDto {
  let webhookUrl: string | null = null;
  if (row.tokenCiphertext) {
    try {
      webhookUrl = webhookUrlFor(decryptWebhookToken(row.tokenCiphertext));
    } catch (error) {
      console.error(`[services] Could not decrypt token for ${row.id}`, error);
    }
  }
  return {
    id: row.id,
    title: row.title,
    imageUrl: row.imageUrl,
    url: row.url,
    webhookUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createServiceForUser(
  userId: string,
  input: ServiceCreateInput,
): Promise<ServiceCreatedResponse> {
  const token = generateWebhookToken();
  const now = new Date();
  const [row] = await db
    .insert(service)
    .values({
      id: newId("svc"),
      userId,
      title: input.title,
      imageUrl: input.imageUrl ?? null,
      url: input.url ?? null,
      tokenHash: hashWebhookToken(token),
      tokenCiphertext: encryptWebhookToken(token),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!row) throw new Error("Failed to create service");
  return {
    service: serviceToDto(row),
    webhookUrl: webhookUrlFor(token),
  };
}

export function webhookUrlFor(token: string): string {
  return `${env.APP_URL.replace(/\/$/, "")}/hooks/${token}`;
}

type ServiceRow = typeof service.$inferSelect;

/** Agent reads never decrypt the webhook token; see {@link AgentServiceDto}. */
function toAgentServiceDto(row: ServiceRow): AgentServiceDto {
  return {
    id: row.id,
    title: row.title,
    imageUrl: row.imageUrl,
    url: row.url,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const SERVICE_NOT_FOUND = { error: "Service not found" } as const;

async function listServices(userId: string): Promise<ServiceRow[]> {
  return db
    .select()
    .from(service)
    .where(eq(service.userId, userId))
    .orderBy(desc(service.createdAt));
}

async function ownedService(userId: string, id: string): Promise<ServiceRow | undefined> {
  const [row] = await db
    .select()
    .from(service)
    .where(and(eq(service.id, id), eq(service.userId, userId)))
    .limit(1);
  return row;
}

async function updateServiceForUser(
  userId: string,
  id: string,
  input: ServiceUpdateInput,
): Promise<ServiceRow | undefined> {
  const [row] = await db
    .update(service)
    .set({
      ...input,
      imageUrl: input.imageUrl === undefined ? undefined : (input.imageUrl ?? null),
      url: input.url === undefined ? undefined : (input.url ?? null),
      updatedAt: new Date(),
    })
    .where(and(eq(service.id, id), eq(service.userId, userId)))
    .returning();
  return row;
}

/** Replaces the webhook token; the plaintext URL is returned exactly once. */
async function rotateServiceForUser(
  userId: string,
  id: string,
): Promise<ServiceCreatedResponse | undefined> {
  const token = generateWebhookToken();
  const [row] = await db
    .update(service)
    .set({
      tokenHash: hashWebhookToken(token),
      tokenCiphertext: encryptWebhookToken(token),
      updatedAt: new Date(),
    })
    .where(and(eq(service.id, id), eq(service.userId, userId)))
    .returning();
  if (!row) return undefined;
  return { service: serviceToDto(row), webhookUrl: webhookUrlFor(token) };
}

async function deleteServiceForUser(userId: string, id: string): Promise<boolean> {
  await syncInboxForUser(userId);
  const deleted = await db
    .delete(service)
    .where(and(eq(service.id, id), eq(service.userId, userId)))
    .returning({ id: service.id });
  if (deleted.length === 0) return false;
  return true;
}

export const servicesRoute = new Hono<AuthedEnv>()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const rows = await listServices(c.get("user").id);
    return c.json({ services: rows.map(serviceToDto) });
  })
  .post("/", async (c) => {
    const user = c.get("user");
    const parsed = serviceCreateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid service", issues: parsed.error.issues }, 400);
    }

    const response = await createServiceForUser(user.id, parsed.data);
    return c.json(response, 201);
  })
  .patch("/:id", async (c) => {
    const parsed = serviceUpdateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid service", issues: parsed.error.issues }, 400);
    }
    const row = await updateServiceForUser(c.get("user").id, c.req.param("id"), parsed.data);
    if (!row) return c.json(SERVICE_NOT_FOUND, 404);
    return c.json({ service: serviceToDto(row) });
  })
  .post("/:id/rotate", async (c) => {
    const response = await rotateServiceForUser(c.get("user").id, c.req.param("id"));
    if (!response) return c.json(SERVICE_NOT_FOUND, 404);
    return c.json(response);
  })
  .delete("/:id", async (c) => {
    const removed = await deleteServiceForUser(c.get("user").id, c.req.param("id"));
    if (!removed) return c.json(SERVICE_NOT_FOUND, 404);
    return c.json({ ok: true });
  });

/** Agent-token twin of {@link servicesRoute}, mounted at `/api/agent/services`. */
export const servicesAgentRoute = new Hono<AgentEnv>()
  .use("*", requireApiToken)
  .get("/", requireScopes("services:read"), async (c) => {
    const rows = await listServices(c.get("apiToken").userId);
    return c.json({ services: rows.map(toAgentServiceDto) });
  })
  .post("/", requireScopes("services:write"), async (c) => {
    const parsed = serviceCreateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid service", issues: parsed.error.issues }, 400);
    }
    const response = await createServiceForUser(c.get("apiToken").userId, parsed.data);
    return c.json(response, 201);
  })
  .get("/:id", requireScopes("services:read"), async (c) => {
    const row = await ownedService(c.get("apiToken").userId, c.req.param("id"));
    if (!row) return c.json(SERVICE_NOT_FOUND, 404);
    return c.json({ service: toAgentServiceDto(row) });
  })
  .patch("/:id", requireScopes("services:write"), async (c) => {
    const parsed = serviceUpdateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid service", issues: parsed.error.issues }, 400);
    }
    const row = await updateServiceForUser(
      c.get("apiToken").userId,
      c.req.param("id"),
      parsed.data,
    );
    if (!row) return c.json(SERVICE_NOT_FOUND, 404);
    return c.json({ service: toAgentServiceDto(row) });
  })
  .post("/:id/rotate", requireScopes("services:write"), async (c) => {
    const response = await rotateServiceForUser(c.get("apiToken").userId, c.req.param("id"));
    if (!response) return c.json(SERVICE_NOT_FOUND, 404);
    return c.json(response);
  })
  .delete("/:id", requireScopes("services:write"), async (c) => {
    const removed = await deleteServiceForUser(c.get("apiToken").userId, c.req.param("id"));
    if (!removed) return c.json(SERVICE_NOT_FOUND, 404);
    return c.json({ ok: true });
  });
