import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

const source = readFileSync(new URL("../SHarkWatchApp.swift", import.meta.url), "utf8");
const content = source.slice(
  source.indexOf("private func content("),
  source.indexOf("private func draftPreview("),
);
const snapshot = source.slice(
  source.indexOf("private struct Snapshot:"),
  source.indexOf("// Draft bodies"),
);

/** Returns the index of the brace that closes the first block opened after `start`. */
function blockEnd(text, start) {
  let depth = 0;
  for (let index = text.indexOf("{", start); index < text.length; index += 1) {
    if (text[index] === "{") depth += 1;
    if (text[index] === "}" && --depth === 0) return index;
  }
  throw new Error("unbalanced braces");
}

const dialogAt = content.search(/\.confirmationDialog\(\s*"Confirm response"/);
const dialog = content.slice(dialogAt);
const dialogActions = dialog.slice(dialog.indexOf(") { pending in"), dialog.indexOf("} message:"));

test("approvals come before drafts, work and recent messages", () => {
  const order = [
    content.indexOf("ForEach(snapshot.openInteractions)"),
    content.indexOf("draftPreview("),
    content.indexOf("ForEach(snapshot.openWork)"),
    content.indexOf("snapshot.recentMessages"),
  ];
  assert.ok(order.every((index) => index >= 0));
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
  );
});

test("cached snapshots and older servers still decode", () => {
  for (const field of [
    /let pendingInteractions: \[Interaction\]\?/,
    /let pendingInteraction: Interaction\?/,
    /let work: \[Work\]\?/,
    /let recentMessages: \[Message\]\?/,
  ]) {
    assert.match(snapshot, field);
  }
});

test("the dialog answers only the payload it presents", () => {
  assert.ok(dialogAt >= 0);
  assert.match(dialog, /presenting: pendingConfirmation\s*\) \{ pending in/);
  assert.match(dialogActions, /model\.respond\(pending\.action, to: pending\.interaction\)/);
  assert.doesNotMatch(dialogActions, /pendingConfirmation|\bitem\b|snapshot\.|openInteractions/);
});

test("the dialog stays mounted outside the approvals conditional", () => {
  const conditional = content.indexOf("if !snapshot.openInteractions.isEmpty {");
  assert.ok(conditional >= 0);
  assert.ok(dialogAt > blockEnd(content, conditional));
});

test("a stale or submitting screen cannot confirm", () => {
  assert.match(dialog, /get: \{ pendingConfirmation != nil && !stale && !model\.isSubmitting \}/);
  const confirm = dialogActions.slice(dialogActions.indexOf('Button("Confirm"'));
  assert.match(confirm, /guard !stale else \{ return \}\s+Task \{ await model\.respond/);
});

test("the selection is cleared when the scene, state or request goes away", () => {
  const phaseAt = source.indexOf(".onChange(of: scenePhase)");
  const phase = source.slice(phaseAt, blockEnd(source, phaseAt));
  assert.match(phase.slice(phase.indexOf("else {")), /pendingConfirmation = nil/);

  const listAt = source.indexOf(".onChange(of: readySnapshot?.openInteractions.map(\\.id))");
  assert.ok(listAt >= 0);
  const list = source.slice(listAt, blockEnd(source, listAt));
  assert.match(
    list,
    /ids\?\.contains\(pending\.interaction\.id\) != true \{\s+pendingConfirmation = nil/,
  );
  const ready = source.slice(source.indexOf("private var readySnapshot: Snapshot?"));
  assert.match(
    ready.slice(0, blockEnd(ready, 0)),
    /if case \.ready\(let snapshot\) = model\.state \{ return snapshot \}\s+return nil/,
  );
});

test("rows hide custom labels with details and cannot start on expired requests", () => {
  const rowsAt = content.indexOf("ForEach(snapshot.openInteractions)");
  const rows = content.slice(rowsAt, blockEnd(content, rowsAt));
  assert.match(rows, /\(model\.hideDetails \? nil : item\.primaryLabel\)/);
  assert.match(rows, /\(model\.hideDetails \? nil : item\.secondaryLabel\)/);
  assert.match(
    rows,
    /\.disabled\(model\.isSubmitting \|\| stale \|\| item\.expiresAt <= Date\(\)\)/,
  );
});

test("the response carries the selected request's id and digest", () => {
  const respond = source.slice(
    source.indexOf("  func respond("),
    source.indexOf("  func clearPrivateDraft("),
  );
  assert.match(respond, /\/api\/watch\/interactions\/\\\(item\.id\)\/respond/);
  assert.match(respond, /"actionDigest": item\.actionDigest/);
});
