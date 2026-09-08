export class BrokerError extends Error {
  constructor(code, diagnostic) {
    super(diagnostic);
    this.name = "BrokerError";
    this.code = code;
  }
}

export function requireValue(condition, field) {
  if (!condition) throw new BrokerError(2, `invalid_${field}`);
}

export function safeError(error) {
  return error instanceof BrokerError
    ? { code: error.code, diagnostic: error.message }
    : { code: 1, diagnostic: "internal_error" };
}
