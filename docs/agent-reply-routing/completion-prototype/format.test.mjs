import assert from "node:assert/strict";
import test from "node:test";
import {
  agentNotificationCreateSchema,
  interactionCreateSchema,
} from "../../../packages/contracts/src/index.ts";
import { CompletionValidationError, formatCompletionContent } from "./format.mjs";

const input = { summary: "Done", idempotencyKey: "synthetic-turn-1" };

test("normalizes before formatting and keeps notification output free of interaction fields", () => {
  const result = formatCompletionContent({
    ...input,
    summary: "  Done  ",
    idempotencyKey: " key ",
  });
  assert.deepEqual(result, {
    type: "notification",
    idempotencyKey: "key",
    content: { title: "SHark", body: "Done" },
  });
  assert.ok(agentNotificationCreateSchema.safeParse(result.content).success);
  assert.equal(
    formatCompletionContent({ ...input, summary: "a".repeat(2001) }).content.body.length,
    2000,
  );
});

test("combines one explicit question and never adds a separate done notice", () => {
  const result = formatCompletionContent({ ...input, question: "  Continue?  ", title: " Task " });
  assert.deepEqual(result.content, { title: "Task", kind: "reply", prompt: "Done\n\nContinue?" });
  assert.equal(result.type, "interaction");
  assert.ok(interactionCreateSchema.safeParse(result.content).success);
  assert.equal(
    formatCompletionContent({ ...input, summary: " ", question: "Continue?" }).content.prompt,
    "Continue?",
  );
});

test("normalization preserves internal whitespace and distinct Unicode content", () => {
  const result = formatCompletionContent({
    summary: "\u00a0\ufeffDone  today\ufeff\u00a0",
    question: "\ufeffContinue?\u00a0",
    title: "\u00a0 SHark \ufeff",
    idempotencyKey: "\ufeff key \u00a0",
  });
  assert.deepEqual(
    result,
    formatCompletionContent({
      summary: "Done  today",
      question: "Continue?",
      idempotencyKey: "key",
    }),
  );
  assert.equal(result.content.prompt, "Done  today\n\nContinue?");
  for (const summary of ["\u200bDone\u200b", "\u00e9", "e\u0301"]) {
    assert.equal(formatCompletionContent({ ...input, summary }).content.body, summary);
  }
  assert.ok(interactionCreateSchema.safeParse(result.content).success);
});

test("matches the exact question and separator boundary against the real server schema", () => {
  for (const size of [1997, 1998, 1999, 2000]) {
    const question = "q".repeat(size);
    const result = formatCompletionContent({ ...input, question });
    assert.equal(result.content.prompt, size === 1997 ? `D\n\n${question}` : question);
    assert.ok(interactionCreateSchema.safeParse(result.content).success);
  }
  assert.throws(
    () => formatCompletionContent({ ...input, question: "q".repeat(2001) }),
    CompletionValidationError,
  );
});

test("uses UTF-16 server limits without splitting a summary surrogate pair", () => {
  const notification = formatCompletionContent({ ...input, summary: `${"a".repeat(1999)}😀` });
  assert.equal(notification.content.body, "a".repeat(1999));
  const question = "😀".repeat(1000);
  const result = formatCompletionContent({ ...input, question });
  assert.equal(result.content.prompt, question);
  assert.ok(interactionCreateSchema.safeParse(result.content).success);
  assert.throws(
    () => formatCompletionContent({ ...input, question: `${question}😀` }),
    CompletionValidationError,
  );
  assert.equal(
    formatCompletionContent({ ...input, summary: "😀done", question: "q".repeat(1997) }).content
      .prompt,
    "q".repeat(1997),
  );
});

test("rejects invalid questions, titles, keys, and empty notification bodies without echoing input", () => {
  const invalid = [
    { summary: " " },
    { summary: null },
    { question: " " },
    { question: null },
    { title: " " },
    { title: "x".repeat(81) },
    { title: "😀".repeat(41) },
    { idempotencyKey: " " },
    { idempotencyKey: undefined },
    { idempotencyKey: "x".repeat(201) },
    { idempotencyKey: "😀".repeat(101) },
  ];
  for (const change of invalid) {
    assert.throws(
      () => formatCompletionContent({ ...input, ...change }),
      (error) => {
        assert.ok(error instanceof CompletionValidationError);
        assert.doesNotMatch(error.message, /synthetic-turn|😀|x{20}/);
        return true;
      },
    );
  }
  const result = formatCompletionContent({
    ...input,
    title: ` ${"x".repeat(80)} `,
    idempotencyKey: ` ${"k".repeat(200)} `,
  });
  assert.equal(result.content.title.length, 80);
  assert.equal(result.idempotencyKey.length, 200);
  const emojiBoundary = formatCompletionContent({
    ...input,
    title: "😀".repeat(40),
    idempotencyKey: "😀".repeat(100),
  });
  assert.equal(emojiBoundary.content.title.length, 80);
  assert.equal(emojiBoundary.idempotencyKey.length, 200);
  assert.ok(agentNotificationCreateSchema.safeParse(emojiBoundary.content).success);
});
