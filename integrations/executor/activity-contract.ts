// Generated from packages/contracts. Run pnpm --filter @hark/website exec tsx ../../packages/contracts/scripts/export-activity-contract.mjs.
export const activitySchemas = {
  start: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      key: {
        type: "string",
        minLength: 1,
        maxLength: 100,
      },
      replace: {
        default: false,
        type: "boolean",
      },
      title: {
        type: "string",
        minLength: 1,
        maxLength: 80,
      },
      status: {
        type: "string",
        minLength: 1,
        maxLength: 60,
      },
      detail: {
        type: "string",
        minLength: 1,
        maxLength: 240,
      },
      progress: {
        type: "number",
        minimum: 0,
        maximum: 1,
      },
      symbol: {
        default: "terminal",
        type: "string",
        enum: ["terminal", "code", "build", "success", "warning"],
      },
      privacyMode: {
        default: "standard",
        type: "string",
        enum: ["standard", "private"],
      },
      accentColor: {
        default: "#D35C46",
        type: "string",
        pattern: "^#[0-9a-fA-F]{6}$",
      },
      style: {
        default: "standard",
        type: "string",
        enum: ["standard", "ring", "hero", "terminal", "steps"],
      },
      deviceIds: {
        minItems: 1,
        maxItems: 50,
        type: "array",
        items: {
          type: "string",
          minLength: 1,
          maxLength: 100,
        },
      },
      expiresInSeconds: {
        default: 28800,
        type: "integer",
        minimum: 60,
        maximum: 28800,
      },
      staleAfterSeconds: {
        default: 14400,
        type: "integer",
        minimum: 0,
        maximum: 28800,
      },
    },
    required: ["title", "status"],
  },
  update: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      title: {
        type: "string",
        minLength: 1,
        maxLength: 80,
      },
      status: {
        type: "string",
        minLength: 1,
        maxLength: 60,
      },
      detail: {
        anyOf: [
          {
            type: "string",
            minLength: 1,
            maxLength: 240,
          },
          {
            type: "null",
          },
        ],
      },
      progress: {
        anyOf: [
          {
            type: "number",
            minimum: 0,
            maximum: 1,
          },
          {
            type: "null",
          },
        ],
      },
      symbol: {
        type: "string",
        enum: ["terminal", "code", "build", "success", "warning"],
      },
      privacyMode: {
        type: "string",
        enum: ["standard", "private"],
      },
      accentColor: {
        type: "string",
        pattern: "^#[0-9a-fA-F]{6}$",
      },
      style: {
        type: "string",
        enum: ["standard", "ring", "hero", "terminal", "steps"],
      },
      staleAfterSeconds: {
        type: "integer",
        minimum: 0,
        maximum: 28800,
      },
      ifSequence: {
        type: "integer",
        minimum: 0,
        maximum: 9007199254740991,
      },
    },
  },
  end: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      status: {
        default: "Complete",
        type: "string",
        minLength: 1,
        maxLength: 60,
      },
      detail: {
        anyOf: [
          {
            type: "string",
            minLength: 1,
            maxLength: 240,
          },
          {
            type: "null",
          },
        ],
      },
      progress: {
        anyOf: [
          {
            type: "number",
            minimum: 0,
            maximum: 1,
          },
          {
            type: "null",
          },
        ],
      },
      symbol: {
        default: "success",
        type: "string",
        enum: ["terminal", "code", "build", "success", "warning"],
      },
      accentColor: {
        type: "string",
        pattern: "^#[0-9a-fA-F]{6}$",
      },
      dismissAfterSeconds: {
        default: 0,
        type: "integer",
        minimum: 0,
        maximum: 14400,
      },
      ifSequence: {
        type: "integer",
        minimum: 0,
        maximum: 9007199254740991,
      },
    },
  },
} as const;
