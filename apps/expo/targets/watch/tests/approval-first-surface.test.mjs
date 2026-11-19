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

/** Returns the text between the brace that opens after `start` and its matching close. */
function block(text, start) {
  const open = text.indexOf("{", start);
  assert.ok(open >= 0, "block has an opening brace");
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "{") depth += 1;
    if (text[index] === "}") depth -= 1;
    if (depth === 0) return { start: open, end: index, text: text.slice(open, index + 1) };
  }
  throw new Error("unbalanced braces");
}

const interactionsAt = content.indexOf("ForEach(snapshot.openInteractions)");
const interactionRow = block(content, interactionsAt);
const dialogAt = content.indexOf('.confirmationDialog("Confirm response"');
const dialogActions = content.slice(dialogAt, content.indexOf("} message:", dialogAt));
const confirmAction = block(dialogActions, dialogActions.indexOf('Button("Confirm"'));

test("approvals come first, then drafts, then work, then recent messages", () => {
  const order = [
    content.indexOf("snapshot.openInteractions"),
    content.indexOf("draftPreview("),
    content.indexOf("ForEach(snapshot.openWork)"),
    content.indexOf("snapshot.recentMessages"),
  ];
  for (const index of order) assert.ok(index >= 0);
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
  );
  assert.ok(content.indexOf('Text("Needs your answer")') < interactionsAt);
});

test("work appears only when there is some, and an empty answer queue says so", () => {
  assert.doesNotMatch(source, /No active work/);
  assert.ok(
    content.indexOf("if !snapshot.openWork.isEmpty {") <
      content.indexOf("ForEach(snapshot.openWork)"),
  );
  assert.match(
    content,
    /if snapshot\.openInteractions\.isEmpty, model\.draft == nil, !model\.draftLoading \{\s+Text\("Nothing needs your answer"\)/,
  );
});

test("snapshot decodes older servers and cached snapshots", () => {
  assert.match(snapshot, /let pendingInteractions: \[Interaction\]\?/);
  assert.match(snapshot, /let pendingInteraction: Interaction\?/);
  assert.match(snapshot, /let work: \[Work\]\?/);
  assert.match(snapshot, /let recentMessages: \[Message\]\?/);
  assert.match(
    snapshot,
    /var openInteractions: \[Interaction\] \{ pendingInteractions \?\? pendingInteraction\.map \{ \[\$0\] \} \?\? \[\] \}/,
  );
});

test("each row captures the tapped interaction and cannot answer by itself", () => {
  assert.match(interactionRow.text, /\.disabled\(model\.isSubmitting \|\| stale\)/);
  assert.equal(
    (interactionRow.text.match(/\{ confirmingInteraction = item; requestedAction = /g) || [])
      .length,
    2,
  );
  assert.doesNotMatch(interactionRow.text, /model\.respond\(|confirmationDialog/);
  assert.equal((content.match(/ProgressView\("Sending…"\)/g) || []).length, 1);
  assert.ok(content.indexOf('ProgressView("Sending…")') > interactionRow.end);
});

test("one dialog, outside the list, confirms exactly the captured interaction", () => {
  assert.equal((source.match(/\.confirmationDialog\("Confirm response"/g) || []).length, 1);
  assert.ok(dialogAt > interactionRow.end);
  assert.match(
    confirmAction.text,
    /if let selected = confirmingInteraction, let action = requestedAction/,
  );
  assert.match(confirmAction.text, /model\.respond\(action, to: selected\)/);
  // A refreshed or reordered list must not be able to change the target.
  assert.doesNotMatch(dialogActions, /\bitem\b|snapshot\.|openInteractions|pendingInteraction/);
  assert.match(confirmAction.text, /requestedAction = nil\s+confirmingInteraction = nil/);
  const message = block(content, content.indexOf("} message:", dialogAt) + 1);
  assert.match(message.text, /model\.hideDetails \? "An approval is waiting" : selected\.title/);
});

test("the response carries the selected interaction's id and digest", () => {
  const respond = source.slice(
    source.indexOf("  func respond("),
    source.indexOf("  func clearPrivateDraft("),
  );
  assert.match(respond, /"\/api\/watch\/interactions\/\\\(item\.id\)\/respond"/);
  assert.match(respond, /"actionDigest": item\.actionDigest/);
});

test("leaving the foreground clears a pending confirmation", () => {
  const phase = block(source, source.indexOf(".onChange(of: scenePhase)"));
  const inactive = phase.text.slice(phase.text.indexOf("else {"));
  assert.match(inactive, /confirmingInteraction = nil/);
  assert.match(inactive, /requestedAction = nil/);
});
