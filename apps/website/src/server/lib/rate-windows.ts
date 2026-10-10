import type { BillingDto } from "@hark/contracts";
import { and, count, eq, gte, isNull, type SQL } from "drizzle-orm";
import type { Executor } from "../db";
import {
  agentNotification,
  agentNotificationRetry,
  event,
  interaction,
  liveActivity,
  liveActivityOperation,
  oncallPage,
  service,
} from "../db/schema";

/**
 * Per-minute service, requester, and account windows. Every function here is
 * synchronous so it can run inside the better-sqlite3 transaction that
 * records the counted row: on SHark's single process and single connection,
 * the count and the insert then cannot interleave with another request, so
 * concurrent requests cannot overshoot a window. Routes also run the same
 * check early, before any side effect, to answer cheaply; that early check is
 * advisory and the in-transaction check is the one that holds. Do not remove
 * the in-transaction check as a duplicate.
 *
 * Events, interactions, agent notifications (including board pushes and
 * their retries), and pages are admitted in the transaction that records
 * them. Live Activity operations and webhook Live Activity responses are not
 * yet; see "Rate limits" in docs/operations.md for those residuals.
 *
 * One definition per window, used by every surface:
 *
 * - Service window (a webhook token): its events, its Live Activity
 *   operations, and its pages.
 * - Requester window (an agent token): its Live Activity operations, its
 *   interactions, its one-shot notifications (including board pushes and
 *   each board push retry), and its pages.
 * - Account window (the owner): every event from the owner's services, every
 *   interaction, agent notification, board push retry, and page, and every
 *   Live Activity operation not tied to an interaction (the interaction
 *   already counts).
 *
 * Every counted row is timestamped by `createdAt` and never moved: a board
 * push's first attempt counts as its notification row, and each retry adds an
 * `agent_notification_retry` row, so earlier attempts keep their usage.
 */

type Limits = Pick<BillingDto["limits"], "servicePerMinute" | "accountPerMinute">;

/** Which window refused the work. */
export type RateWindow = "service" | "requester" | "account";

const WINDOW_MS = 60_000;

export const RATE_LIMIT_ERRORS = {
  service: "Service rate limit exceeded",
  requester: "Requester rate limit exceeded",
  account: "Account rate limit exceeded",
} satisfies Record<RateWindow, string>;

function value(row: { value: number } | undefined): number {
  return row?.value ?? 0;
}

function countPagesSince(
  executor: Executor,
  by: { userId: string } | { serviceId: string } | { tokenId: string },
  since: Date,
): number {
  const owner =
    "userId" in by
      ? eq(oncallPage.createdByUserId, by.userId)
      : "serviceId" in by
        ? eq(oncallPage.requesterServiceId, by.serviceId)
        : eq(oncallPage.requesterTokenId, by.tokenId);
  return value(
    executor
      .select({ value: count() })
      .from(oncallPage)
      .where(and(owner, gte(oncallPage.createdAt, since)))
      .get(),
  );
}

function liveActivityOperations(executor: Executor, where: SQL | undefined): number {
  return value(
    executor
      .select({ value: count() })
      .from(liveActivityOperation)
      .innerJoin(liveActivity, eq(liveActivity.id, liveActivityOperation.activityId))
      .where(where)
      .get(),
  );
}

/** Account window usage since `since`; see the module comment for what counts. */
export function accountWindowUsage(executor: Executor, userId: string, since: Date): number {
  return (
    value(
      executor
        .select({ value: count() })
        .from(event)
        .innerJoin(service, eq(event.serviceId, service.id))
        .where(and(eq(service.userId, userId), gte(event.createdAt, since)))
        .get(),
    ) +
    value(
      executor
        .select({ value: count() })
        .from(interaction)
        .where(and(eq(interaction.userId, userId), gte(interaction.createdAt, since)))
        .get(),
    ) +
    value(
      executor
        .select({ value: count() })
        .from(agentNotification)
        .where(and(eq(agentNotification.userId, userId), gte(agentNotification.createdAt, since)))
        .get(),
    ) +
    value(
      executor
        .select({ value: count() })
        .from(agentNotificationRetry)
        .where(
          and(
            eq(agentNotificationRetry.userId, userId),
            gte(agentNotificationRetry.createdAt, since),
          ),
        )
        .get(),
    ) +
    liveActivityOperations(
      executor,
      and(
        eq(liveActivity.userId, userId),
        gte(liveActivityOperation.createdAt, since),
        isNull(liveActivity.interactionId),
      ),
    ) +
    countPagesSince(executor, { userId }, since)
  );
}

/** Service window usage since `since`; see the module comment for what counts. */
export function serviceWindowUsage(executor: Executor, serviceId: string, since: Date): number {
  return (
    value(
      executor
        .select({ value: count() })
        .from(event)
        .where(and(eq(event.serviceId, serviceId), gte(event.createdAt, since)))
        .get(),
    ) +
    value(
      executor
        .select({ value: count() })
        .from(liveActivityOperation)
        .where(
          and(
            eq(liveActivityOperation.requesterServiceId, serviceId),
            gte(liveActivityOperation.createdAt, since),
          ),
        )
        .get(),
    ) +
    countPagesSince(executor, { serviceId }, since)
  );
}

/** Requester window usage since `since`; see the module comment for what counts. */
export function requesterWindowUsage(executor: Executor, tokenId: string, since: Date): number {
  return (
    liveActivityOperations(
      executor,
      and(
        eq(liveActivityOperation.requesterTokenId, tokenId),
        gte(liveActivityOperation.createdAt, since),
        isNull(liveActivity.interactionId),
      ),
    ) +
    value(
      executor
        .select({ value: count() })
        .from(interaction)
        .where(and(eq(interaction.requesterTokenId, tokenId), gte(interaction.createdAt, since)))
        .get(),
    ) +
    value(
      executor
        .select({ value: count() })
        .from(agentNotification)
        .where(
          and(
            eq(agentNotification.requesterTokenId, tokenId),
            gte(agentNotification.createdAt, since),
          ),
        )
        .get(),
    ) +
    value(
      executor
        .select({ value: count() })
        .from(agentNotificationRetry)
        .where(
          and(
            eq(agentNotificationRetry.requesterTokenId, tokenId),
            gte(agentNotificationRetry.createdAt, since),
          ),
        )
        .get(),
    ) +
    countPagesSince(executor, { tokenId }, since)
  );
}

/** Webhook work (events, pages, Live Activities): the service window, then the account window. */
export function webhookWindowLimit(
  executor: Executor,
  svc: { id: string; userId: string },
  limits: Limits,
  now = Date.now(),
): "service" | "account" | null {
  const since = new Date(now - WINDOW_MS);
  if (serviceWindowUsage(executor, svc.id, since) >= limits.servicePerMinute) return "service";
  if (accountWindowUsage(executor, svc.userId, since) >= limits.accountPerMinute) return "account";
  return null;
}

/** Agent-token work: the requester window, then the account window. */
export function agentWindowLimit(
  executor: Executor,
  token: { id: string; userId: string },
  limits: Limits,
  now = Date.now(),
): "requester" | "account" | null {
  const since = new Date(now - WINDOW_MS);
  if (requesterWindowUsage(executor, token.id, since) >= limits.servicePerMinute) {
    return "requester";
  }
  if (accountWindowUsage(executor, token.userId, since) >= limits.accountPerMinute) {
    return "account";
  }
  return null;
}

/** Admission for a webhook service or an agent token, by whichever credential sent the work. */
export type RateAdmission = (tx: Executor) => RateWindow | null;

export function webhookAdmission(
  svc: { id: string; userId: string },
  limits: Limits,
): RateAdmission {
  return (tx) => webhookWindowLimit(tx, svc, limits);
}

export function agentAdmission(
  token: { id: string; userId: string },
  limits: Limits,
): RateAdmission {
  return (tx) => agentWindowLimit(tx, token, limits);
}
