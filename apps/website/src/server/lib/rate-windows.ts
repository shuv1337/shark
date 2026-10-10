import type { BillingDto } from "@hark/contracts";
import { and, count, eq, gte, isNull } from "drizzle-orm";
import {
  agentNotification,
  event,
  interaction,
  liveActivity,
  liveActivityOperation,
  service,
} from "../db/schema";
import { countPagesSince, type Executor } from "./oncall";

/**
 * Per-minute service, requester, and account windows. Every function here is
 * synchronous: called inside the better-sqlite3 transaction that records the
 * work, the count and the insert cannot interleave with another request on
 * the single connection, so concurrent requests cannot overshoot a window.
 */

type Limits = Pick<BillingDto["limits"], "servicePerMinute" | "accountPerMinute">;

const WINDOW_MS = 60_000;

export const RATE_LIMIT_ERRORS = {
  service: "Service rate limit exceeded",
  requester: "Requester rate limit exceeded",
  account: "Account rate limit exceeded",
} as const;

function value(row: { value: number } | undefined): number {
  return row?.value ?? 0;
}

/**
 * Webhook deliveries: the service window counts its events and pages; the
 * account window adds every event, interaction, Live Activity operation, and
 * page of the owner.
 */
export function webhookWindowLimit(
  executor: Executor,
  svc: { id: string; userId: string },
  limits: Limits,
  now = Date.now(),
): "service" | "account" | null {
  const since = new Date(now - WINDOW_MS);
  const serviceUsage =
    value(
      executor
        .select({ value: count() })
        .from(event)
        .where(and(eq(event.serviceId, svc.id), gte(event.createdAt, since)))
        .get(),
    ) + countPagesSince(executor, { serviceId: svc.id }, since);
  if (serviceUsage >= limits.servicePerMinute) return "service";
  const accountUsage =
    value(
      executor
        .select({ value: count() })
        .from(event)
        .innerJoin(service, eq(event.serviceId, service.id))
        .where(and(eq(service.userId, svc.userId), gte(event.createdAt, since)))
        .get(),
    ) +
    value(
      executor
        .select({ value: count() })
        .from(interaction)
        .where(and(eq(interaction.userId, svc.userId), gte(interaction.createdAt, since)))
        .get(),
    ) +
    value(
      executor
        .select({ value: count() })
        .from(liveActivityOperation)
        .innerJoin(liveActivity, eq(liveActivity.id, liveActivityOperation.activityId))
        .where(
          and(eq(liveActivity.userId, svc.userId), gte(liveActivityOperation.createdAt, since)),
        )
        .get(),
    ) +
    countPagesSince(executor, { userId: svc.userId }, since);
  if (accountUsage >= limits.accountPerMinute) return "account";
  return null;
}

/**
 * The shared agent budget: Live Activity operations, interactions, one-shot
 * notifications, and pages count against the token's requester window; the
 * account window adds the owner's webhook events.
 */
export function agentWindowLimit(
  executor: Executor,
  token: { id: string; userId: string },
  limits: Limits,
  now = Date.now(),
): string | null {
  const since = new Date(now - WINDOW_MS);
  const requesterUsage =
    value(
      executor
        .select({ value: count() })
        .from(liveActivityOperation)
        .innerJoin(liveActivity, eq(liveActivity.id, liveActivityOperation.activityId))
        .where(
          and(
            eq(liveActivityOperation.requesterTokenId, token.id),
            gte(liveActivityOperation.createdAt, since),
            isNull(liveActivity.interactionId),
          ),
        )
        .get(),
    ) +
    value(
      executor
        .select({ value: count() })
        .from(interaction)
        .where(and(eq(interaction.requesterTokenId, token.id), gte(interaction.createdAt, since)))
        .get(),
    ) +
    value(
      executor
        .select({ value: count() })
        .from(agentNotification)
        .where(
          and(
            eq(agentNotification.requesterTokenId, token.id),
            gte(agentNotification.createdAt, since),
          ),
        )
        .get(),
    ) +
    countPagesSince(executor, { tokenId: token.id }, since);
  if (requesterUsage >= limits.servicePerMinute) return RATE_LIMIT_ERRORS.requester;
  const accountUsage =
    value(
      executor
        .select({ value: count() })
        .from(liveActivityOperation)
        .innerJoin(liveActivity, eq(liveActivity.id, liveActivityOperation.activityId))
        .where(
          and(
            eq(liveActivity.userId, token.userId),
            gte(liveActivityOperation.createdAt, since),
            isNull(liveActivity.interactionId),
          ),
        )
        .get(),
    ) +
    value(
      executor
        .select({ value: count() })
        .from(interaction)
        .where(and(eq(interaction.userId, token.userId), gte(interaction.createdAt, since)))
        .get(),
    ) +
    value(
      executor
        .select({ value: count() })
        .from(agentNotification)
        .where(
          and(eq(agentNotification.userId, token.userId), gte(agentNotification.createdAt, since)),
        )
        .get(),
    ) +
    value(
      executor
        .select({ value: count() })
        .from(event)
        .innerJoin(service, eq(event.serviceId, service.id))
        .where(and(eq(service.userId, token.userId), gte(event.createdAt, since)))
        .get(),
    ) +
    countPagesSince(executor, { userId: token.userId }, since);
  if (accountUsage >= limits.accountPerMinute) return RATE_LIMIT_ERRORS.account;
  return null;
}
