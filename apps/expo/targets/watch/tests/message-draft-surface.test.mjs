import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const source = readFileSync(new URL('../SHarkWatchApp.swift', import.meta.url), 'utf8');
const preview = source.slice(source.indexOf('private func draftPreview('), source.indexOf('private func setup('));
const cache = source.slice(source.indexOf('private enum SnapshotCache'));
const snapshot = source.slice(source.indexOf('private struct Snapshot:'), source.indexOf('// Draft bodies'));
test('full exact body precedes Send; hidden details removes all draft actions', () => {
  assert.match(preview, /if model.hideDetails/);
  assert.ok(preview.indexOf('Text(item.text)') < preview.indexOf('Button("Send")'));
  assert.doesNotMatch(preview, /lineLimit\(/);
  assert.match(preview, /item.status != "pending"/);
  assert.match(preview, /item.expiresAt <= Date\(\)/);
});
test('draft text is excluded from persistent snapshots and cleared when inactive', () => {
  assert.doesNotMatch(snapshot, /MessageDraft|messageDraft/);
  assert.doesNotMatch(cache, /MessageDraft|messageDraft/);
  assert.match(source, /model.clearPrivateDraft\(\)/);
  assert.match(source, /generation == draftGeneration/);
  assert.match(source, /reloadIgnoringLocalCacheData/);
});
test('native editor starts prefilled and Save edits instead of sending', () => {
  assert.match(preview, /draftText = item.text; editingDraft = item/);
  assert.match(source, /TextField\("Message", text: \$draftText\)/);
  const save = source.slice(source.indexOf('Button("Save")'), source.indexOf('Button("Cancel") { editingDraft'));
  assert.match(save, /model.editDraft/);
  assert.doesNotMatch(save, /respondToDraft/);
});
test('draft mutation sends both revision and digest; delivery is not presumed', () => {
  assert.equal((source.match(/"expectedRevision": item.revision, "actionDigest": item.actionDigest/g) || []).length, 2);
  assert.match(source, /Delivery is not yet confirmed/);
  assert.match(source, /Never retry a send automatically/);
  assert.match(source, /snapshot.pendingInteraction/); // legacy approval UI retained
});
