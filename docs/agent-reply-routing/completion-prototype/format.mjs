// Reference prototype only: no package export, broker seam, storage, or network.
export class CompletionValidationError extends Error {
  constructor(field, reason) {
    super(`Invalid ${field}: ${reason}.`);
    this.field = field;
  }
}

function normalized(value, field, maximum, allowEmpty = false) {
  if (typeof value !== "string") {
    throw new CompletionValidationError(field, "expected text");
  }
  const text = value.trim();
  if ((!allowEmpty && text.length === 0) || text.length > maximum) {
    throw new CompletionValidationError(field, "outside the permitted length");
  }
  return text;
}

// Zod's server limits count UTF-16 units. Keep that budget while avoiding a
// newly split surrogate pair when a well-formed summary must be shortened.
function truncateSummary(text, maximum) {
  let length = 0;
  for (const character of text) {
    if (length + character.length > maximum) break;
    length += character.length;
  }
  return text.slice(0, length);
}

export function formatCompletionContent({ summary, question, title, idempotencyKey }) {
  const normalizedSummary = normalized(summary, "summary", Infinity, question !== undefined);
  const normalizedTitle = normalized(title === undefined ? "SHark" : title, "title", 80);
  const key = normalized(idempotencyKey, "idempotencyKey", 200);
  if (question === undefined) {
    return {
      type: "notification",
      idempotencyKey: key,
      content: { title: normalizedTitle, body: truncateSummary(normalizedSummary, 2000) },
    };
  }
  const normalizedQuestion = normalized(question, "question", 2000);
  const available = Math.max(0, 2000 - normalizedQuestion.length - 2);
  const prefix = truncateSummary(normalizedSummary, available);
  return {
    type: "interaction",
    idempotencyKey: key,
    content: {
      title: normalizedTitle,
      kind: "reply",
      prompt: prefix ? `${prefix}\n\n${normalizedQuestion}` : normalizedQuestion,
    },
  };
}
