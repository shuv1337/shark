import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

const source = readFileSync(new URL("../SHarkWatchApp.swift", import.meta.url), "utf8");
const refresh = source.slice(
  source.indexOf("  func refresh()"),
  source.indexOf("  func beginAuthorization()"),
);
const authorization = source.slice(
  source.indexOf("  func beginAuthorization()"),
  source.indexOf("  func respond("),
);
const poll = authorization.slice(authorization.indexOf("  private func pollAuthorization("));

test("rejection requires an explicit reconnect; offline refresh preserves its fallback", () => {
  assert.match(refresh, /statusCode == 401[\s\S]*state = \.reconnect/);
  assert.match(refresh, /catch \{[\s\S]*lastSnapshot\.map\(State\.stale\)/);
  assert.doesNotMatch(
    refresh.slice(refresh.indexOf("statusCode == 401")),
    /beginAuthorization|SnapshotCache\.write|Keychain\.write/,
  );
  assert.match(source, /Button\("Reconnect"\) \{ Task \{ await model\.beginAuthorization\(\)/);
});

test("cancel supersedes in-flight work before credential or cache replacement", () => {
  assert.match(authorization, /func cancelAuthorization\(\)[\s\S]*endAuthorization\(attempt/);
  assert.match(
    authorization,
    /guard authorizationAttempt == attempt else \{ return \}\s*authorizationAttempt = nil/,
  );
  assert.match(
    poll,
    /request\("\/api\/watch\/snapshot", token: candidate\.accessToken\)\s*guard authorizationAttempt == attempt else \{ return \}\s*guard Keychain\.write/,
  );
  assert.match(source, /Button\("Cancel"\) \{ model\.cancelAuthorization\(\) \}/);
});

test("transient poll and verification failures preserve the existing token and cache", () => {
  assert.match(poll, /catch \{ continue \}/);
  assert.match(
    poll,
    /guard Keychain\.write[\s\S]*token = candidate\.accessToken[\s\S]*SnapshotCache\.write/,
  );
  assert.match(poll, /catch \{\s*endAuthorization\(attempt, message: "Couldn’t verify/);
  assert.match(source, /SecItemUpdate[\s\S]*guard status == errSecItemNotFound/);
  assert.doesNotMatch(source, /SecItemDelete/);
});
