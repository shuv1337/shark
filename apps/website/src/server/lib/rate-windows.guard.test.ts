import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every row in these tables counts toward a per-minute rate window, so each
 * insert must run in the synchronous transaction that checks the windows
 * (see rate-windows.ts). Drizzle export name to SQL table name.
 */
const COUNTED_TABLES = {
  event: "event",
  interaction: "interaction",
  agentNotification: "agent_notification",
  agentNotificationRetry: "agent_notification_retry",
  oncallPage: "oncall_page",
  liveActivityOperation: "live_activity_operation",
} as const;

type CountedTable = keyof typeof COUNTED_TABLES;

interface AdmittedInsert {
  file: string;
  table: CountedTable;
  receiver: string;
  count: number;
  admittedBy: string;
}

/** Call sites known to insert counted rows, and how each is admitted. */
const ADMITTED_INSERTS: AdmittedInsert[] = [
  {
    file: "routes/hooks.ts",
    table: "event",
    receiver: "tx",
    count: 1,
    admittedBy: "webhook notification transaction (service and account windows)",
  },
  {
    file: "routes/hooks.ts",
    table: "interaction",
    receiver: "tx",
    count: 1,
    admittedBy: "webhook `response`, in the same transaction as its event",
  },
  {
    file: "routes/interactions.ts",
    table: "interaction",
    receiver: "tx",
    count: 1,
    admittedBy: "agent interaction transaction (agentWindowLimit)",
  },
  {
    file: "routes/interactions.ts",
    table: "agentNotification",
    receiver: "tx",
    count: 1,
    admittedBy: "agent notification transaction (agentWindowLimit)",
  },
  {
    file: "lib/board-push.ts",
    table: "agentNotification",
    receiver: "tx",
    count: 1,
    admittedBy: "board push claim transaction",
  },
  {
    file: "lib/board-push.ts",
    table: "agentNotificationRetry",
    receiver: "tx",
    count: 1,
    admittedBy: "board push retry claim transaction",
  },
  {
    file: "lib/oncall.ts",
    table: "oncallPage",
    receiver: "tx",
    count: 1,
    admittedBy: "page transaction (requester, account, and group windows)",
  },
  {
    file: "routes/activities.ts",
    table: "liveActivityOperation",
    receiver: "tx",
    count: 4,
    admittedBy: "agent Live Activity start, update, end, and the shared update/end admission",
  },
  {
    file: "routes/activity-hooks.ts",
    table: "liveActivityOperation",
    receiver: "tx",
    count: 1,
    admittedBy: "webhook Live Activity start transaction",
  },
  {
    file: "lib/teams.ts",
    table: "agentNotification",
    receiver: "db",
    count: 1,
    admittedBy:
      "accepted residual: team notices are capped per sender, not by the windows (docs/operations.md)",
  },
];

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [path];
  });
}

/** Local identifiers that refer to counted tables in this file. */
function countedBindings(source: string) {
  const names = new Map<string, CountedTable>();
  const namespaces: string[] = [];
  const schemaImport =
    /import\s+(type\s+)?([^;]*?)\s+from\s+["'](?:\.\.?\/)+(?:db\/)?schema(?:\.ts)?["']/g;
  for (const match of source.matchAll(schemaImport)) {
    if (match[1]) continue;
    const clause = match[2] ?? "";
    const namespace = /\*\s+as\s+(\w+)/.exec(clause);
    if (namespace?.[1]) namespaces.push(namespace[1]);
    const named = /\{([^}]*)\}/.exec(clause);
    for (const part of named?.[1]?.split(",") ?? []) {
      const [imported, local] = part
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/);
      if (imported && imported in COUNTED_TABLES) {
        names.set(local ?? imported, imported as CountedTable);
      }
    }
  }
  return { names, namespaces };
}

interface Hit {
  file: string;
  table: CountedTable;
  receiver: string;
  line: number;
}

function lineAt(source: string, index: number) {
  return source.slice(0, index).split("\n").length;
}

function findCountedInserts(): Hit[] {
  const hits: Hit[] = [];
  const sqlTables = Object.entries(COUNTED_TABLES) as Array<[CountedTable, string]>;
  for (const path of sourceFiles(serverRoot)) {
    const file = relative(serverRoot, path).split("\\").join("/");
    const source = readFileSync(path, "utf8");
    const { names, namespaces } = countedBindings(source);

    for (const match of source.matchAll(/(\w+)\s*\.\s*insert\s*\(\s*([\w.]+)\s*\)/g)) {
      const [, receiver = "", target = ""] = match;
      const [head, member] = target.split(".");
      const table =
        member && head && namespaces.includes(head) && member in COUNTED_TABLES
          ? (member as CountedTable)
          : !member && head
            ? names.get(head)
            : undefined;
      if (table) hits.push({ file, table, receiver, line: lineAt(source, match.index ?? 0) });
    }

    for (const match of source.matchAll(/insert\s+(?:or\s+\w+\s+)?into\s+["`]?(\w+)["`]?/gi)) {
      const entry = sqlTables.find(([, sqlName]) => sqlName === match[1]?.toLowerCase());
      if (entry) {
        hits.push({
          file,
          table: entry[0],
          receiver: "raw SQL",
          line: lineAt(source, match.index ?? 0),
        });
      }
    }
  }
  return hits;
}

describe("rate window admission guard", () => {
  it("keeps every insert into a counted table on an admitted call site", () => {
    const hits = findCountedInserts();
    const problems: string[] = [];

    for (const hit of hits) {
      const known = ADMITTED_INSERTS.some(
        (entry) =>
          entry.file === hit.file && entry.table === hit.table && entry.receiver === hit.receiver,
      );
      if (!known) {
        problems.push(
          `src/server/${hit.file}:${hit.line} inserts into counted table \`${hit.table}\` via \`${hit.receiver}\`, which is not an admitted call site.`,
        );
      }
    }

    for (const entry of ADMITTED_INSERTS) {
      const found = hits.filter(
        (hit) =>
          hit.file === entry.file && hit.table === entry.table && hit.receiver === entry.receiver,
      );
      if (found.length !== entry.count) {
        problems.push(
          `src/server/${entry.file} has ${found.length} \`${entry.receiver}.insert(${entry.table})\` call(s), expected ${entry.count} (${entry.admittedBy})${
            found.length > 0 ? `: lines ${found.map((hit) => hit.line).join(", ")}` : ""
          }.`,
        );
      }
    }

    expect(
      problems,
      [
        "Rows in counted tables must be inserted inside the synchronous transaction that checks",
        "the rate windows (see src/server/lib/rate-windows.ts), so concurrent requests cannot",
        "overshoot a limit. Admit the new insert that way, then update ADMITTED_INSERTS in",
        "src/server/lib/rate-windows.guard.test.ts with the call site and how it is admitted.",
        ...problems,
      ].join("\n"),
    ).toEqual([]);
  });

  it("detects inserts through aliases, namespaces, and raw SQL", () => {
    const source = [
      'import { event as eventTable, user } from "../db/schema";',
      'import * as schema from "./db/schema";',
    ].join("\n");
    const { names, namespaces } = countedBindings(source);
    expect(names.get("eventTable")).toBe("event");
    expect(names.has("user")).toBe(false);
    expect(namespaces).toEqual(["schema"]);
    expect(findCountedInserts().length).toBeGreaterThan(0);
  });
});
