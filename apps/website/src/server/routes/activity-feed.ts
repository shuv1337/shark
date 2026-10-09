import {
  INBOX_ACTIVITY_KINDS,
  type InboxActivityDto,
  type InboxActivityPageDto,
} from "@hark/contracts";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import {
  type AgentEnv,
  type AuthedEnv,
  requireApiToken,
  requireAuth,
  requireScopes,
} from "../middleware";

const PAGE_SIZE = 20;
const MAX_PAGE = 1_000_000;
const FILTERS = ["all", ...INBOX_ACTIVITY_KINDS] as const;
type ActivityFilter = (typeof FILTERS)[number];

interface ActivityFeedRow {
  id: string;
  kind: "notification" | "live_activity" | "response";
  sourceName: string;
  sourceImageUrl: string | null;
  title: string;
  detail: string | null;
  url: string | null;
  result: string | null;
  createdAt: number;
  total: number;
}

type FeedOutcome = { ok: true; body: InboxActivityPageDto } | { ok: false; error: string };

/** One page of the account's merged activity history, newest first. */
function readActivityFeed(
  userId: string,
  filterParam: string | undefined,
  pageParam: string | undefined,
): FeedOutcome {
  const requestedFilter = filterParam ?? "all";
  if (!FILTERS.includes(requestedFilter as ActivityFilter)) {
    return { ok: false, error: "Invalid activity filter" };
  }
  const filter = requestedFilter as ActivityFilter;
  const requestedPage = Number.parseInt(pageParam ?? "0", 10);
  if (!Number.isFinite(requestedPage) || requestedPage < 0 || requestedPage > MAX_PAGE) {
    return { ok: false, error: "Invalid activity page" };
  }
  const filterClause = filter === "all" ? sql`1 = 1` : sql`kind = ${filter}`;
  const offset = requestedPage * PAGE_SIZE;

  const rows = db.all(sql`
    select
      id,
      kind,
      source_name as sourceName,
      source_image_url as sourceImageUrl,
      title,
      detail,
      url,
      result,
      created_at as createdAt,
      count(*) over () as total
    from (
      select
        'event:' || e.id as id,
        'notification' as kind,
        s.title as source_name,
        coalesce(e.image_url, s.image_url) as source_image_url,
        e.title as title,
        -- Bounded for app builds that predate the project inbox: bodies at or
        -- under the legacy 2,000-character limit pass through unchanged, and
        -- larger bodies fall back to the sender summary or a bounded preview.
        coalesce(e.summary, substr(e.body, 1, 2000)) as detail,
        e.url as url,
        null as result,
        e.created_at as created_at
      from event e
      inner join service s on s.id = e.service_id
      where s.user_id = ${userId}

      union all

      select
        'notification:' || n.id as id,
        'notification' as kind,
        coalesce(n.source_name, t.name, n.title) as source_name,
        n.image_url as source_image_url,
        n.title as title,
        coalesce(n.summary, substr(n.body, 1, 2000)) as detail,
        n.url as url,
        null as result,
        n.created_at as created_at
      from agent_notification n
      left join api_token t on t.id = n.requester_token_id
      where n.user_id = ${userId}

      union all

      select
        'response:' || i.id as id,
        'response' as kind,
        coalesce(s.title, t.name, i.title) as source_name,
        coalesce(i.image_url, s.image_url) as source_image_url,
        i.title as title,
        i.prompt as detail,
        i.url as url,
        case i.status
          when 'approved' then 'Approved'
          when 'denied' then 'Denied'
          when 'yes' then 'Yes'
          when 'no' then 'No'
          else 'Replied'
        end as result,
        i.responded_at as created_at
      from interaction i
      left join api_token t on t.id = i.requester_token_id
      left join service s on s.id = i.requester_service_id
      where i.user_id = ${userId}
        and i.status in ('approved', 'denied', 'yes', 'no', 'replied')
        and i.responded_at is not null

      union all

      select
        'live_activity:' || o.id as id,
        'live_activity' as kind,
        coalesce(s.title, t.name, 'SHark') as source_name,
        s.image_url as source_image_url,
        coalesce(
          json_extract(o.props, '$.title'),
          json_extract(a.props, '$.title'),
          'Live Activity'
        ) as title,
        coalesce(
          json_extract(o.props, '$.status'),
          json_extract(a.props, '$.status')
        ) as detail,
        null as url,
        case o.event
          when 'start' then 'Started'
          when 'end' then 'Completed'
          else 'Updated'
        end as result,
        o.created_at as created_at
      from live_activity_operation o
      inner join live_activity a on a.id = o.activity_id
      left join api_token t on t.id = o.requester_token_id
      left join service s on s.id = o.requester_service_id
      where a.user_id = ${userId}
        and a.interaction_id is null
    ) feed
    where ${filterClause}
    order by created_at desc, id desc
    limit ${PAGE_SIZE}
    offset ${offset}
  `) as ActivityFeedRow[];

  const items: InboxActivityDto[] = rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    sourceName: row.sourceName,
    sourceImageUrl: row.sourceImageUrl,
    title: row.title,
    detail: row.detail,
    url: row.url,
    result: row.result,
    createdAt: new Date(row.createdAt).toISOString(),
  }));

  return {
    ok: true,
    body: { items, page: requestedPage, pageSize: PAGE_SIZE, total: rows[0]?.total ?? 0 },
  };
}

export const activityFeedRoute = new Hono<AuthedEnv>().use("*", requireAuth).get("/", (c) => {
  const result = readActivityFeed(c.get("user").id, c.req.query("filter"), c.req.query("page"));
  return result.ok ? c.json(result.body) : c.json({ error: result.error }, 400);
});

/** Agent-token twin of {@link activityFeedRoute}, mounted at `/api/agent/activity-feed`. */
export const activityFeedAgentRoute = new Hono<AgentEnv>()
  .use("*", requireApiToken)
  .get("/", requireScopes("events:read"), (c) => {
    const result = readActivityFeed(
      c.get("apiToken").userId,
      c.req.query("filter"),
      c.req.query("page"),
    );
    return result.ok ? c.json(result.body) : c.json({ error: result.error }, 400);
  });
