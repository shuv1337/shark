import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { databaseContractIssue } from "../src/server/db/contract";

const source = resolve(process.env.DATABASE_URL ?? "/data/hark.sqlite");
const destination = resolve(
  process.env.BACKUP_DATABASE_URL ??
    `/data/backups/hark.sqlite.${new Date().toISOString().replaceAll(/[:.]/g, "-")}`,
);
if (source === destination) throw new Error("Backup destination must differ from DATABASE_URL.");

mkdirSync(dirname(destination), { recursive: true });
const live = new Database(source);
try {
  live.pragma("wal_checkpoint(TRUNCATE)");
} finally {
  live.close();
}
copyFileSync(source, destination);

const backup = new Database(destination, { readonly: true, fileMustExist: true });
try {
  const integrity = backup.pragma("integrity_check", { simple: true });
  if (integrity !== "ok") throw new Error("Backup failed integrity_check.");

  const contractIssue = databaseContractIssue(backup);
  if (contractIssue) throw new Error(`Backup contract check failed: ${contractIssue}`);
} catch (error) {
  backup.close();
  rmSync(destination, { force: true });
  throw error;
}
backup.close();
rmSync(`${destination}-wal`, { force: true });
rmSync(`${destination}-shm`, { force: true });

console.log(JSON.stringify({ ok: true, file: basename(destination) }));
