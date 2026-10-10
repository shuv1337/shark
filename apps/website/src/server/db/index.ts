import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { env } from "../env";
import * as schema from "./schema";

const file = env.DATABASE_URL;
if (file !== ":memory:") {
  mkdirSync(dirname(resolve(file)), { recursive: true });
}

export const sqlite = new Database(file);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

/** The connection or a transaction on it; synchronous `.get()`/`.run()` work on both. */
export type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
