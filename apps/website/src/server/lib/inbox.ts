import { sql } from "drizzle-orm";
import { db } from "../db";

/**
 * Materializes the canonical product tables into a durable account inbox.
 *
 * This is intentionally idempotent and runs before inbox reads and source
 * deletion. The deployment migration performs the initial backfill; this
 * reconciler keeps lifecycle state current without coupling notification
 * delivery to inbox availability.
 */
export async function syncInboxForUser(userId: string): Promise<void> {
  const now = Date.now();

  // Webhook pushes that created an interaction are represented by the
  // interaction item, avoiding duplicate cards for one user-visible request.
  db.run(sql`
    insert into inbox_item (
      id, user_id, entity_type, entity_id, kind, source_name, source_image_url,
      title, body, image_url, url, status, result, accepted_count, failed_count,
      needs_action, occurred_at, updated_at
    )
    select
      'ibox:event:' || e.id, s.user_id, 'event', e.id, 'notification',
      s.title, coalesce(e.image_url, s.image_url), e.title, e.body, e.image_url,
      e.url, e.status,
      case when e.status in ('accepted', 'delivered') then 'Accepted'
           when e.status = 'partial' then 'Partially accepted'
           when e.status = 'no_devices' then 'No active devices'
           when e.status = 'failed' then coalesce(e.error, 'Failed')
           else null end,
      e.delivered_count, case when e.status = 'failed' then 1 else 0 end,
      0, e.created_at, e.created_at
    from event e
    inner join service s on s.id = e.service_id
    where s.user_id = ${userId}
      and not exists (select 1 from interaction i where i.event_id = e.id)
    on conflict(entity_type, entity_id) do update set
      status = excluded.status,
      result = excluded.result,
      accepted_count = excluded.accepted_count,
      failed_count = excluded.failed_count,
      updated_at = excluded.updated_at
  `);

  db.run(sql`
    insert into inbox_item (
      id, user_id, entity_type, entity_id, kind, source_name, source_image_url,
      title, body, image_url, url, status, result, accepted_count, failed_count,
      needs_action, occurred_at, updated_at
    )
    select
      'ibox:agent_notification:' || n.id, n.user_id, 'agent_notification', n.id,
      'notification', t.name, n.image_url, n.title, n.body, n.image_url, n.url,
      n.status,
      case when n.status = 'accepted' then 'Accepted'
           when n.status = 'partial' then 'Partially accepted'
           when n.status = 'failed' then coalesce(n.error, 'Failed')
           when n.status = 'no_devices' then 'No active devices'
           else 'Processing' end,
      n.accepted_count, n.failed_count, 0, n.created_at, n.created_at
    from agent_notification n
    inner join api_token t on t.id = n.requester_token_id
    where n.user_id = ${userId}
    on conflict(entity_type, entity_id) do update set
      status = excluded.status,
      result = excluded.result,
      accepted_count = excluded.accepted_count,
      failed_count = excluded.failed_count,
      updated_at = excluded.updated_at
  `);

  db.run(sql`
    insert into inbox_item (
      id, user_id, entity_type, entity_id, kind, source_name, source_image_url,
      title, body, image_url, url, status, result, accepted_count, failed_count,
      needs_action, occurred_at, updated_at
    )
    select
      'ibox:interaction:' || i.id, i.user_id, 'interaction', i.id, 'interaction',
      coalesce(s.title, t.name, 'SHark'), coalesce(i.image_url, s.image_url),
      i.title, i.prompt, i.image_url, i.url,
      case when i.status = 'pending' and i.expires_at <= ${now} then 'expired' else i.status end,
      case
        when i.status = 'approved' then 'Approved'
        when i.status = 'denied' then 'Denied'
        when i.status = 'yes' then 'Yes'
        when i.status = 'no' then 'No'
        when i.status = 'replied' then 'Replied'
        when i.status = 'canceled' then 'Canceled'
        when i.status = 'expired' or (i.status = 'pending' and i.expires_at <= ${now}) then 'Expired'
        else null
      end,
      i.accepted_count, 0,
      case when i.status = 'pending' and i.expires_at > ${now} then 1 else 0 end,
      i.created_at, coalesce(i.responded_at, i.canceled_at, i.created_at)
    from interaction i
    left join service s on s.id = i.requester_service_id
    left join api_token t on t.id = i.requester_token_id
    where i.user_id = ${userId}
    on conflict(entity_type, entity_id) do update set
      status = excluded.status,
      result = excluded.result,
      accepted_count = excluded.accepted_count,
      needs_action = excluded.needs_action,
      updated_at = excluded.updated_at
  `);

  db.run(sql`
    insert into inbox_item (
      id, user_id, entity_type, entity_id, kind, source_name, source_image_url,
      title, body, image_url, url, status, result, accepted_count, failed_count,
      needs_action, occurred_at, updated_at
    )
    select
      'ibox:live_activity:' || a.id, a.user_id, 'live_activity', a.id, 'live_activity',
      coalesce(s.title, t.name, 'SHark'), s.image_url,
      coalesce(json_extract(a.props, '$.title'), 'Live Activity'),
      coalesce(json_extract(a.props, '$.detail'), json_extract(a.props, '$.status'), ''),
      null, null,
      case when a.status in ('starting', 'active', 'partial') and a.expires_at <= ${now}
        then 'expired' else a.status end,
      case when a.status in ('starting', 'active', 'partial') and a.expires_at <= ${now}
           then 'Expired'
           when a.status = 'ended' then 'Completed'
           when a.status = 'expired' then 'Expired'
           when a.status = 'failed' then 'Failed'
           when a.status in ('starting', 'active', 'partial') then 'Active'
           else a.status end,
      a.accepted_count, a.failed_count,
      0, a.created_at, a.updated_at
    from live_activity a
    left join service s on s.id = a.requester_service_id
    left join api_token t on t.id = a.requester_token_id
    where a.user_id = ${userId} and a.interaction_id is null
    on conflict(entity_type, entity_id) do update set
      title = excluded.title,
      body = excluded.body,
      status = excluded.status,
      result = excluded.result,
      accepted_count = excluded.accepted_count,
      failed_count = excluded.failed_count,
      updated_at = excluded.updated_at
  `);

  // Every card begins with a durable creation entry.
  db.run(sql`
    insert or ignore into inbox_item_event (
      id, inbox_item_id, dedupe_key, kind, detail, result,
      accepted_count, failed_count, occurred_at
    )
    select
      item.id || ':created', item.id, 'created', 'created', item.body, null,
      item.accepted_count, item.failed_count, item.occurred_at
    from inbox_item item
    where item.user_id = ${userId}
  `);

  db.run(sql`
    insert or ignore into inbox_item_event (
      id, inbox_item_id, dedupe_key, kind, detail, result,
      accepted_count, failed_count, occurred_at
    )
    select
      'iboxev:event:' || e.id || ':' || e.status,
      case when i.id is null then 'ibox:event:' || e.id else 'ibox:interaction:' || i.id end,
      'delivery:' || e.status, 'delivery',
      e.error,
      case when e.status in ('accepted', 'delivered') then 'Accepted'
           when e.status = 'partial' then 'Partially accepted'
           when e.status = 'no_devices' then 'No active devices'
           when e.status = 'failed' then coalesce(e.error, 'Failed')
           else 'Processing' end,
      e.delivered_count, case when e.status = 'failed' then 1 else 0 end, e.created_at
    from event e
    inner join service s on s.id = e.service_id
    left join interaction i on i.event_id = e.id
    where s.user_id = ${userId}
      and exists (
        select 1 from inbox_item item
        where item.id = case when i.id is null
          then 'ibox:event:' || e.id else 'ibox:interaction:' || i.id end
      )
  `);

  db.run(sql`
    insert or ignore into inbox_item_event (
      id, inbox_item_id, dedupe_key, kind, detail, result,
      accepted_count, failed_count, occurred_at
    )
    select
      'iboxev:agent_notification:' || n.id || ':' || n.status,
      'ibox:agent_notification:' || n.id, 'delivery:' || n.status, 'delivery', n.error,
      case when n.status = 'accepted' then 'Accepted'
           when n.status = 'partial' then 'Partially accepted'
           when n.status = 'failed' then coalesce(n.error, 'Failed')
           when n.status = 'no_devices' then 'No active devices'
           else 'Processing' end,
      n.accepted_count, n.failed_count, n.created_at
    from agent_notification n
    where n.user_id = ${userId}
  `);

  db.run(sql`
    insert or ignore into inbox_item_event (
      id, inbox_item_id, dedupe_key, kind, detail, result,
      accepted_count, failed_count, occurred_at
    )
    select
      'iboxev:interaction:' || i.id || ':' || coalesce(i.responded_at, i.canceled_at, i.expires_at),
      'ibox:interaction:' || i.id,
      'terminal:' || case when i.status = 'pending' and i.expires_at <= ${now} then 'expired' else i.status end,
      'response', i.response,
      case when i.status = 'pending' and i.expires_at <= ${now} then 'Expired'
           when i.status = 'approved' then 'Approved'
           when i.status = 'denied' then 'Denied'
           when i.status = 'yes' then 'Yes'
           when i.status = 'no' then 'No'
           when i.status = 'replied' then 'Replied'
           when i.status = 'canceled' then 'Canceled'
           else i.status end,
      i.accepted_count, 0,
      coalesce(i.responded_at, i.canceled_at, i.expires_at)
    from interaction i
    where i.user_id = ${userId}
      and (i.status <> 'pending' or i.expires_at <= ${now})
  `);

  // Standalone activities and interaction-backed Live Activities share the
  // same grouped timeline rather than producing duplicate list entries.
  db.run(sql`
    insert or ignore into inbox_item_event (
      id, inbox_item_id, dedupe_key, kind, detail, result,
      accepted_count, failed_count, occurred_at
    )
    select
      'iboxev:operation:' || o.id,
      case when a.interaction_id is null
        then 'ibox:live_activity:' || a.id
        else 'ibox:interaction:' || a.interaction_id end,
      'operation:' || o.id, 'live_activity_' || o.event,
      coalesce(json_extract(a.props, '$.detail'), json_extract(a.props, '$.status')),
      case when o.event = 'start' then 'Started'
           when o.event = 'end' then 'Completed'
           else 'Updated' end,
      o.accepted_count, o.failed_count, o.created_at
    from live_activity_operation o
    inner join live_activity a on a.id = o.activity_id
    where a.user_id = ${userId}
  `);

  db.run(sql`
    insert or ignore into inbox_item_event (
      id, inbox_item_id, dedupe_key, kind, detail, result,
      accepted_count, failed_count, occurred_at
    )
    select
      'iboxev:activity-expired:' || a.id,
      'ibox:live_activity:' || a.id, 'terminal:expired', 'expired',
      coalesce(json_extract(a.props, '$.detail'), json_extract(a.props, '$.status')),
      'Expired', a.accepted_count, a.failed_count, a.expires_at
    from live_activity a
    where a.user_id = ${userId}
      and a.interaction_id is null
      and a.status in ('starting', 'active', 'partial')
      and a.expires_at <= ${now}
  `);

  db.run(sql`
    insert or ignore into inbox_item_event (
      id, inbox_item_id, dedupe_key, kind, detail, result,
      accepted_count, failed_count, occurred_at
    )
    select
      'iboxev:attempt:' || attempt.id,
      case when a.interaction_id is null
        then 'ibox:live_activity:' || a.id
        else 'ibox:interaction:' || a.interaction_id end,
      'attempt:' || attempt.id, 'delivery_attempt', attempt.apns_reason,
      case when attempt.apns_status between 200 and 299 then 'Accepted'
           else coalesce(attempt.apns_reason, 'Failed') end,
      case when attempt.apns_status between 200 and 299 then 1 else 0 end,
      case when attempt.apns_status between 200 and 299 then 0 else 1 end,
      attempt.created_at
    from live_activity_delivery_attempt attempt
    inner join live_activity a on a.id = attempt.activity_id
    where a.user_id = ${userId}
  `);
}
