import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { BrokerError } from "./errors.mjs";
import { prepareDatabase } from "./files.mjs";
import { stableJSON } from "./json.mjs";

export const RETAIN_MS = 7 * 86_400_000;
export const FINAL_STATES = new Set([
  "delivered",
  "expired",
  "canceled",
  "undeliverable",
  "discarded",
  "superseded",
  "stale",
]);
const AUTOMATIC = [
  "creating",
  "pending",
  "reconciling_zero",
  "canceling",
  "ready",
  "delivering",
  "auth_blocked",
];
const hashKey = (key) => createHash("sha256").update(key).digest("hex");

function decode(row) {
  if (!row) return undefined;
  return {
    id: row.id,
    key: row.key,
    tokenID: row.token_id,
    kind: row.kind,
    state: row.state,
    data: JSON.parse(row.data_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
    leaseOwner: row.lease_owner,
    leaseUntil: row.lease_until,
  };
}

export class Store {
  static async open(file, options) {
    return new Store(await prepareDatabase(file), options);
  }
  constructor(file, { now = Date.now, busyTimeout = 5000 } = {}) {
    this.now = now;
    this.depth = 0;
    this.db = new DatabaseSync(file);
    try {
      this.db.exec(
        `PRAGMA busy_timeout=${Math.min(30_000, Math.max(1, Math.trunc(busyTimeout)))}; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;`,
      );
      this.transaction(() => {
        const version = this.db.prepare("PRAGMA user_version").get().user_version;
        if (version > 1) throw new BrokerError(1, "newer_store_version");
        if (version === 0) {
          this.db.exec(`
          CREATE TABLE items (
            id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, token_id TEXT NOT NULL,
            kind TEXT NOT NULL CHECK(kind IN ('notification','deferred','active')),
            state TEXT NOT NULL, data_json TEXT NOT NULL,
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
            next_attempt_at INTEGER NOT NULL, last_error TEXT,
            lease_owner TEXT, lease_until INTEGER
          );
          CREATE INDEX items_due ON items(state,next_attempt_at);
          CREATE TABLE retired_keys (key_hash TEXT PRIMARY KEY, retired_at INTEGER NOT NULL);
          CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE daemon_state (
            singleton INTEGER PRIMARY KEY CHECK(singleton=1), instance_id TEXT NOT NULL,
            pid INTEGER NOT NULL, exec_path TEXT NOT NULL, entry_path TEXT NOT NULL,
            started_at INTEGER NOT NULL, heartbeat_at INTEGER NOT NULL,
            last_poll_at INTEGER, last_error_class TEXT
          );
          PRAGMA user_version=1;
        `);
          this.db.prepare("INSERT INTO metadata(key,value) VALUES ('host_id',?)").run(randomUUID());
        }
      });
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  close() {
    this.db.close();
  }
  hostID() {
    return this.db.prepare("SELECT value FROM metadata WHERE key='host_id'").get().value;
  }
  transaction(fn) {
    if (this.depth) return fn();
    this.db.exec("BEGIN IMMEDIATE");
    this.depth++;
    try {
      const value = fn();
      if (value && typeof value.then === "function")
        throw new Error("SQLite transaction cannot be async");
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.depth--;
    }
  }
  get(id) {
    return decode(this.db.prepare("SELECT * FROM items WHERE id=?").get(id));
  }
  byKey(key) {
    return decode(this.db.prepare("SELECT * FROM items WHERE key=?").get(key));
  }
  isKeyRetired(key) {
    return Boolean(
      this.db.prepare("SELECT 1 FROM retired_keys WHERE key_hash=?").get(hashKey(key)),
    );
  }
  insert({ key, tokenID, kind, data, state = "creating" }) {
    return this.transaction(() => {
      const existing = this.byKey(key);
      if (existing) {
        if (existing.tokenID !== tokenID || existing.data.apiUrl !== data.apiUrl)
          throw new BrokerError(3, "creating_identity_changed");
        if (existing.kind !== kind || existing.data.intentHash !== data.intentHash)
          throw new BrokerError(1, "idempotency_conflict");
        return existing;
      }
      if (this.isKeyRetired(key)) throw new BrokerError(1, "retired_idempotency_key");
      const id = randomUUID();
      const now = this.now();
      const encoded = stableJSON(data);
      if (Buffer.byteLength(encoded) > 262_144) throw new BrokerError(2, "record_too_large");
      this.db
        .prepare(
          "INSERT INTO items(id,key,token_id,kind,state,data_json,created_at,updated_at,next_attempt_at) VALUES (?,?,?,?,?,?,?,?,?)",
        )
        .run(id, key, tokenID, kind, state, encoded, now, now, now);
      return this.get(id);
    });
  }
  claim(id, owner, leaseMs = 60_000) {
    const now = this.now();
    return decode(
      this.db
        .prepare(
          "UPDATE items SET lease_owner=?,lease_until=? WHERE id=? AND (lease_owner IS NULL OR lease_until<=?) RETURNING *",
        )
        .get(owner, now + leaseMs, id, now),
    );
  }
  release(id, owner) {
    this.db
      .prepare("UPDATE items SET lease_owner=NULL,lease_until=NULL WHERE id=? AND lease_owner=?")
      .run(id, owner);
  }
  update(id, owner, changes) {
    return this.transaction(() => {
      const row = this.get(id);
      if (!row || row.leaseOwner !== owner) throw new BrokerError(6, "lease_lost");
      const data = { ...row.data, ...changes.data };
      for (const key of [
        "intentHash",
        "intent",
        "apiUrl",
        "session",
        "active",
        "deliveryID",
        "nativeInput",
      ]) {
        if (row.data[key] !== undefined && stableJSON(row.data[key]) !== stableJSON(data[key]))
          throw new BrokerError(1, "immutable_intent_changed");
      }
      if (
        row.data.payload !== undefined &&
        stableJSON(row.data.payload) !== stableJSON(data.payload)
      ) {
        const { deviceIds: _oldDevices, ...oldContent } = row.data.payload;
        const { deviceIds: _newDevices, ...newContent } = data.payload;
        if (
          !(
            row.state === "rejected" &&
            row.data.replaceDevices === true &&
            changes.state === "creating" &&
            stableJSON(oldContent) === stableJSON(newContent)
          )
        )
          throw new BrokerError(1, "persisted_payload_changed");
      }
      const encoded = stableJSON(data);
      if (Buffer.byteLength(encoded) > 262_144) throw new BrokerError(2, "record_too_large");
      this.db
        .prepare(
          "UPDATE items SET state=?,data_json=?,updated_at=?,next_attempt_at=?,last_error=? WHERE id=? AND lease_owner=?",
        )
        .run(
          changes.state ?? row.state,
          encoded,
          this.now(),
          changes.nextAttemptAt ?? row.nextAttemptAt,
          Object.hasOwn(changes, "lastError") ? changes.lastError : row.lastError,
          id,
          owner,
        );
      return this.get(id);
    });
  }
  due(limit = 100) {
    const marks = AUTOMATIC.map(() => "?").join(",");
    return this.db
      .prepare(
        `SELECT id FROM items WHERE state IN (${marks}) AND next_attempt_at<=? AND (lease_owner IS NULL OR lease_until<=?) ORDER BY next_attempt_at,created_at LIMIT ?`,
      )
      .all(...AUTOMATIC, this.now(), this.now(), limit)
      .map((row) => row.id);
  }
  list({ includeContent = false } = {}) {
    const rows = this.db.prepare("SELECT * FROM items ORDER BY created_at,id").all().map(decode);
    return includeContent
      ? rows
      : rows.map(({ id, kind, state, createdAt, updatedAt, nextAttemptAt, lastError }) => ({
          id,
          kind,
          state,
          createdAt,
          updatedAt,
          nextAttemptAt,
          lastError,
        }));
  }
  counts() {
    return Object.fromEntries(
      this.db
        .prepare("SELECT state,COUNT(*) AS count FROM items GROUP BY state")
        .all()
        .map((row) => [row.state, row.count]),
    );
  }
  prune() {
    return this.transaction(() => {
      const marks = [...FINAL_STATES].map(() => "?").join(",");
      const rows = this.db
        .prepare(
          `SELECT id,key FROM items WHERE state IN (${marks}) AND updated_at<? AND lease_owner IS NULL`,
        )
        .all(...FINAL_STATES, this.now() - RETAIN_MS);
      for (const row of rows) {
        this.db
          .prepare("INSERT OR IGNORE INTO retired_keys(key_hash,retired_at) VALUES (?,?)")
          .run(hashKey(row.key), this.now());
        this.db.prepare("DELETE FROM items WHERE id=?").run(row.id);
      }
      return rows.length;
    });
  }
  daemonState() {
    const row = this.db.prepare("SELECT * FROM daemon_state WHERE singleton=1").get();
    return row
      ? {
          instanceID: row.instance_id,
          pid: row.pid,
          execPath: row.exec_path,
          entryPath: row.entry_path,
          startedAt: row.started_at,
          heartbeatAt: row.heartbeat_at,
          lastPollAt: row.last_poll_at,
          lastErrorClass: row.last_error_class,
        }
      : undefined;
  }
  acquireDaemon({ instanceID, pid, execPath, entryPath }, isAlive) {
    return this.transaction(() => {
      const old = this.daemonState();
      if (old && this.now() - old.heartbeatAt <= 90_000 && isAlive(old.pid))
        throw new BrokerError(6, "daemon_already_running");
      this.db
        .prepare(
          "INSERT OR REPLACE INTO daemon_state(singleton,instance_id,pid,exec_path,entry_path,started_at,heartbeat_at) VALUES (1,?,?,?,?,?,?)",
        )
        .run(instanceID, pid, execPath, entryPath, this.now(), this.now());
    });
  }
  heartbeat(instanceID, { polled = false, error = null } = {}) {
    const updated = this.db
      .prepare(
        "UPDATE daemon_state SET heartbeat_at=?,last_error_class=?,last_poll_at=CASE WHEN ? THEN ? ELSE last_poll_at END WHERE singleton=1 AND instance_id=?",
      )
      .run(this.now(), error, polled ? 1 : 0, this.now(), instanceID);
    if (!updated.changes) throw new BrokerError(6, "daemon_ownership_lost");
  }
}
