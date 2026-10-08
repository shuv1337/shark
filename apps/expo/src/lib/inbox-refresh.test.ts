import { describe, expect, it } from "vitest";
import { createFocusRefreshPolicy, createRefreshSequence } from "./inbox-refresh";

describe("createFocusRefreshPolicy", () => {
  it("skips the mount focus so the initial-load effect owns it", () => {
    const policy = createFocusRefreshPolicy();
    expect(policy.onFocus(true)).toBe(false);
  });

  it("refreshes when focus returns after a blur", () => {
    const policy = createFocusRefreshPolicy();
    policy.onFocus(true); // Mount.
    policy.onBlur(); // Project screen pushed.
    expect(policy.onFocus(true)).toBe(true); // Back to the inbox.
  });

  it("requires a new blur before the next focus refresh", () => {
    const policy = createFocusRefreshPolicy();
    policy.onFocus(true);
    policy.onBlur();
    expect(policy.onFocus(true)).toBe(true);
    // A repeated focus without an intervening blur (effect re-run) is inert.
    expect(policy.onFocus(true)).toBe(false);
    policy.onBlur();
    expect(policy.onFocus(true)).toBe(true);
  });

  it("defers to the initial load while the session or device is not ready", () => {
    const policy = createFocusRefreshPolicy();
    policy.onFocus(false);
    policy.onBlur();
    expect(policy.onFocus(false)).toBe(false);
    // The initial-load effect fires when its gates open; the next real
    // return to the screen refreshes again.
    policy.onBlur();
    expect(policy.onFocus(true)).toBe(true);
  });
});

describe("createRefreshSequence", () => {
  it("treats only the newest begun refresh as current", () => {
    const sequence = createRefreshSequence();
    const first = sequence.begin();
    expect(sequence.isCurrent(first)).toBe(true);

    // A focus refresh starts while the timer refresh is still in flight:
    // the older response must not apply.
    const second = sequence.begin();
    expect(sequence.isCurrent(first)).toBe(false);
    expect(sequence.isCurrent(second)).toBe(true);
  });

  it("never treats a foreign or stale token as current", () => {
    const sequence = createRefreshSequence();
    expect(sequence.isCurrent(0)).toBe(false);
    expect(sequence.isCurrent(1)).toBe(false);
    sequence.begin();
    expect(sequence.isCurrent(2)).toBe(false);
  });
});
