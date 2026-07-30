import {
  type ServiceCreatedResponse,
  type ServiceCreateInput,
  type ServiceDto,
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
import { type AuthedEnv, requireAuth } from "../middleware";

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

export const servicesRoute = new Hono<AuthedEnv>()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const user = c.get("user");
    const rows = await db
      .select()
      .from(service)
      .where(eq(service.userId, user.id))
      .orderBy(desc(service.createdAt));
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
    const user = c.get("user");
    const parsed = serviceUpdateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid service", issues: parsed.error.issues }, 400);
    }
    const [row] = await db
      .update(service)
      .set({
        ...parsed.data,
        imageUrl: parsed.data.imageUrl === undefined ? undefined : (parsed.data.imageUrl ?? null),
        url: parsed.data.url === undefined ? undefined : (parsed.data.url ?? null),
        updatedAt: new Date(),
      })
      .where(and(eq(service.id, c.req.param("id")), eq(service.userId, user.id)))
      .returning();
    if (!row) return c.json({ error: "Service not found" }, 404);
    return c.json({ service: serviceToDto(row) });
  })
  .post("/:id/rotate", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const token = generateWebhookToken();
    const [row] = await db
      .update(service)
      .set({
        tokenHash: hashWebhookToken(token),
        tokenCiphertext: encryptWebhookToken(token),
        updatedAt: new Date(),
      })
      .where(and(eq(service.id, id), eq(service.userId, user.id)))
      .returning();
    if (!row) {
      return c.json({ error: "Service not found" }, 404);
    }
    const response: ServiceCreatedResponse = {
      service: serviceToDto(row),
      webhookUrl: webhookUrlFor(token),
    };
    return c.json(response);
  })
  .delete("/:id", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    // Freeze source metadata and any final lifecycle state before cascading
    // deletion removes the canonical service-owned records.
    await syncInboxForUser(user.id);
    const deleted = await db
      .delete(service)
      .where(and(eq(service.id, id), eq(service.userId, user.id)))
      .returning({ id: service.id });
    if (deleted.length === 0) {
      return c.json({ error: "Service not found" }, 404);
    }
    return c.json({ ok: true });
  });
