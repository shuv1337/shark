import { describe, expect, it } from "vitest";
import { z } from "zod";
import { activityBody, activityInput } from "../../../integrations/executor/activity";
import { activitySchemas } from "../../../integrations/executor/activity-contract";
import { sharkRequest } from "../../../integrations/executor/shark";
import { liveActivityEndSchema, liveActivityStartSchema, liveActivityUpdateSchema } from "./index";

describe("Executor activity contract", () => {
  it("is generated from the server request contracts", () => {
    for (const [name, schema] of Object.entries({
      start: liveActivityStartSchema,
      update: liveActivityUpdateSchema,
      end: liveActivityEndSchema,
    })) {
      expect(activitySchemas[name as keyof typeof activitySchemas]).toEqual(
        z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }),
      );
    }
  });
  it("accepts a minimal start and normalizes optional nulls", () => {
    const result = activityBody("start", {
      title: " Run ",
      status: "Starting",
      symbol: null,
      progress: null,
      style: null,
    });
    expect(result.body).toEqual(
      liveActivityStartSchema.parse({ title: "Run", status: "Starting" }),
    );
  });
  it.each([
    { symbol: "bolt" },
    { style: "approval" },
    { style: "shell" },
    { style: "verdict" },
    { style: "signal" },
    { progress: 2 },
    { expiresInSeconds: 1 },
    { title: "x".repeat(81) },
    { status: " " },
    { deviceIds: Array(51).fill("dev_test") },
  ])("rejects invalid start %j", (fields) => {
    expect(() => activityBody("start", { title: "Run", status: "Starting", ...fields })).toThrow(
      /Invalid activity fields/,
    );
  });
  it("preserves explicit clears and rejects empty updates", () => {
    expect(
      activityBody("update", { idOrKey: "act_test", detail: null, progress: null, symbol: null })
        .body,
    ).toEqual({ detail: null, progress: null });
    expect(() =>
      activityBody("update", { idOrKey: "act_test", ifSequence: 3, symbol: null }),
    ).toThrow(/At least one/);
    expect(
      activityBody("end", { idOrKey: "act_test", idempotencyKey: "end-test", progress: null }).body,
    ).toEqual({ status: "Complete", symbol: "success", dismissAfterSeconds: 0, progress: null });
  });
  it("exposes constraints directly in discovery", () => {
    expect(activityInput("start").properties.symbol).toMatchObject({
      enum: ["terminal", "code", "build", "success", "warning"],
      default: "terminal",
    });
  });
  it("retains safe conflict details and excludes arbitrary response content", async () => {
    const response = {
      error: "secret must not be echoed",
      code: "ACTIVE_ACTIVITY_CONFLICT",
      activityId: "act_test",
      ownedByRequester: false,
      token: "secret",
    };
    await expect(
      sharkRequest({
        token: "synthetic",
        path: "/api/agent/activities",
        fetch: async () => new Response(JSON.stringify(response), { status: 409 }),
      }),
    ).rejects.toMatchObject({
      code: "ACTIVE_ACTIVITY_CONFLICT",
      message: expect.stringContaining("ownedByRequester=false"),
    });
    try {
      await sharkRequest({
        token: "synthetic",
        path: "/api/agent/activities",
        fetch: async () => new Response(JSON.stringify(response), { status: 409 }),
      });
    } catch (error) {
      expect(String(error)).not.toContain("secret");
    }
  });
});
