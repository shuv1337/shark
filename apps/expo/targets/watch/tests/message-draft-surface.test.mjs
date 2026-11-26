import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

const source = readFileSync(new URL("../SHarkWatchApp.swift", import.meta.url), "utf8");
const preview = source.slice(
  source.indexOf("private func draftPreview("),
  source.indexOf("private func setup("),
);
const cache = source.slice(source.indexOf("private enum SnapshotCache"));
const snapshot = source.slice(
  source.indexOf("private struct Snapshot:"),
  source.indexOf("// Draft bodies"),
);
test("full exact body precedes Send; hidden details removes all draft actions", () => {
  assert.match(preview, /if model.hideDetails/);
  assert.ok(preview.indexOf("Text(item.text)") < preview.indexOf('Button("Send")'));
  assert.doesNotMatch(preview, /lineLimit\(/);
  assert.match(preview, /item.status != "pending"/);
  assert.match(preview, /item.expiresAt <= Date\(\)/);
});
test("draft text is excluded from persistent snapshots and cleared when inactive", () => {
  assert.doesNotMatch(snapshot, /MessageDraft|messageDraft/);
  assert.doesNotMatch(cache, /MessageDraft|messageDraft/);
  assert.match(source, /model.clearPrivateDraft\(\)/);
  assert.match(source, /generation == draftGeneration/);
  assert.match(source, /reloadIgnoringLocalCacheData/);
});
test("native editor starts prefilled and Save edits instead of sending", () => {
  assert.match(preview, /draftText = item.text; editingDraft = item/);
  assert.match(source, /TextField\("Message", text: \$draftText\)/);
  const save = source.slice(
    source.indexOf('Button("Save")'),
    source.indexOf('Button("Cancel") { editingDraft'),
  );
  assert.match(save, /model.editDraft/);
  assert.doesNotMatch(save, /respondToDraft/);
});
test("draft mutation sends both revision and digest; delivery is not presumed", () => {
  assert.equal(
    (source.match(/"expectedRevision": item.revision, "actionDigest": item.actionDigest/g) || [])
      .length,
    2,
  );
  assert.match(source, /Delivery is not yet confirmed/);
  assert.match(source, /Never retry a send automatically/);
  // Approvals render from openInteractions, which falls back to an older server's single pendingInteraction.
  assert.match(snapshot, /pendingInteractions \?\? pendingInteraction\.map \{ \[\$0\] \}/);
  assert.match(source, /ForEach\(snapshot\.openInteractions\)/);
});
test("delayed edit and response completions cannot overwrite a newer foreground generation", () => {
  const edit = source.slice(
    source.indexOf("  func editDraft("),
    source.indexOf("  func respondToDraft("),
  );
  const respond = source.slice(
    source.indexOf("  func respondToDraft("),
    source.indexOf("  func setPrivacy("),
  );
  for (const method of [edit, respond]) {
    assert.match(method, /let generation = draftGeneration/);
    assert.equal(
      (method.match(/guard privateDraftsActive, generation == draftGeneration/g) || []).length,
      2,
    );
    assert.match(
      method,
      /let recoveryGeneration = draftGeneration \+ 1\s+await refreshDraft\(\)\s+guard privateDraftsActive, recoveryGeneration == draftGeneration/,
    );
    const success = method.slice(0, method.indexOf("    } catch"));
    const mutation = Math.max(
      success.indexOf("      draft = result.draft"),
      success.indexOf("      draft = nil"),
    );
    assert.ok(
      success.indexOf("guard privateDraftsActive, generation == draftGeneration") < mutation,
    );
  }
  const clear = source.slice(
    source.indexOf("  func clearPrivateDraft("),
    source.indexOf("  func activatePrivateDrafts("),
  );
  assert.match(clear, /draftGeneration \+= 1/);
});
test("draft confirmation binds payload on WatchRoot.body and clears on inactive or identity change", () => {
  function blockEnd(text, start) {
    let depth = 0;
    for (let index = text.indexOf("{", start); index < text.length; index += 1) {
      if (text[index] === "{") depth += 1;
      if (text[index] === "}" && --depth === 0) return index;
    }
    throw new Error("unbalanced braces");
  }
  const rootBody = source.slice(
    source.indexOf("var body: some View"),
    source.indexOf("private var readySnapshot:"),
  );
  const dialogAt = rootBody.search(/\.confirmationDialog\(\s*"Confirm exact draft"/);
  assert.ok(dialogAt >= 0);
  assert.equal(preview.search(/\.confirmationDialog\(\s*"Confirm exact draft"/), -1);
  const dialogEnd = rootBody.indexOf("} message:", dialogAt);
  const dialog = rootBody.slice(dialogAt, blockEnd(rootBody, dialogEnd));
  const dialogActions = dialog.slice(
    dialog.indexOf(") { pending in"),
    dialog.indexOf("} message:"),
  );
  assert.match(dialog, /presenting: pendingDraftConfirmation\s*\) \{ pending in/);
  assert.match(dialogActions, /model\.respondToDraft\(pending\.action, item: pending\.draft\)/);
  assert.doesNotMatch(
    dialogActions,
    /pendingDraftConfirmation|confirmingDraft|draftConfirmation|\bmodel\.draft\b|\bitem\b(?!:)/,
  );
  assert.match(
    dialog,
    /get: \{ pendingDraftConfirmation != nil && readySnapshot != nil && !model\.hideDetails && !model\.isSubmitting && !model\.draftLoading \}/,
  );
  assert.match(
    dialogActions,
    /guard readySnapshot != nil, !model\.hideDetails, !model\.isSubmitting, !model\.draftLoading, pending\.draft\.status == "pending", pending\.draft\.expiresAt > Date\(\) else \{ return \}\s+Task \{ await model\.respondToDraft/,
  );

  const phaseAt = rootBody.indexOf(".onChange(of: scenePhase)");
  const phase = rootBody.slice(phaseAt, blockEnd(rootBody, phaseAt));
  assert.match(phase.slice(phase.indexOf("else {")), /pendingDraftConfirmation = nil/);

  const identityChangeAt = rootBody.indexOf(".onChange(of: readyDraftIdentity)");
  assert.ok(identityChangeAt >= 0);
  const identityChange = rootBody.slice(identityChangeAt, blockEnd(rootBody, identityChangeAt));
  assert.match(identityChange, /pendingDraftConfirmation = nil/);

  const readyIdentityAt = source.indexOf("private var readyDraftIdentity: ReadyDraftIdentity?");
  assert.ok(readyIdentityAt >= 0);
  const readyIdentity = source.slice(readyIdentityAt, blockEnd(source, readyIdentityAt));
  assert.match(readyIdentity, /guard readySnapshot != nil, !model\.hideDetails/);
  assert.match(readyIdentity, /draft\.status == "pending"/);
});
