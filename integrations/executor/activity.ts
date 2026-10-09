import { z } from "zod";
import { activitySchemas } from "./activity-contract";
import { SharkError } from "./shark";

type Operation = keyof typeof activitySchemas;

/** Whole-object JSON Schema preserves the contract's enums, limits and nullability. */
export function activityInput(operation: Operation) {
  const schema = activitySchemas[operation];
  return {
    ...schema,
    properties: {
      ...schema.properties,
      ...(operation === "start" ? {} : { idOrKey: { type: "string", minLength: 1 } }),
      idempotencyKey: { type: "string", minLength: 1, maxLength: 200 },
    },
    required: [
      ...("required" in schema ? schema.required : []),
      ...(operation === "start" ? [] : ["idOrKey"]),
      ...(operation === "end" ? ["idempotencyKey"] : []),
    ],
    additionalProperties: false,
  };
}

export function activityBody(operation: Operation, raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new SharkError("Expected activity input object", 400, "invalid_input");
  const input = raw as Record<string, unknown>;
  const normalized = Object.fromEntries(
    Object.entries(input)
      .filter(
        ([key, value]) =>
          value !== undefined &&
          (value !== null || (operation !== "start" && (key === "detail" || key === "progress"))),
      )
      .map(([key, value]) => [key, typeof value === "string" ? value.trim() : value]),
  );
  const schema: Parameters<typeof z.fromJSONSchema>[0] = JSON.parse(
    JSON.stringify(activityInput(operation)),
  );
  const parsed = z.fromJSONSchema(schema).safeParse(normalized);
  if (!parsed.success) {
    // Never include received values, raw bodies or credentials in diagnostics.
    const fields = [
      ...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "input"))),
    ].filter((field) => /^[a-zA-Z][a-zA-Z0-9]{0,40}$/.test(field));
    throw new SharkError(
      `Invalid activity fields: ${fields.join(", ")}. See the tool schema for allowed values and limits.`,
      400,
      "invalid_input",
    );
  }
  const { idOrKey, idempotencyKey, ...body } = parsed.data as Record<string, unknown>;
  if (operation === "update" && !Object.keys(body).some((key) => key !== "ifSequence"))
    throw new SharkError(
      "At least one activity field other than ifSequence is required",
      400,
      "invalid_input",
    );
  return {
    body,
    idOrKey: idOrKey as string | undefined,
    idempotencyKey: idempotencyKey as string | undefined,
  };
}
