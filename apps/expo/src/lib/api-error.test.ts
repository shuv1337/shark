import { describe, expect, it } from "vitest";
import { ApiError, apiErrorFromBody, classifyNotificationDetailFailure } from "./api-error";

describe("apiErrorFromBody", () => {
  it("carries the structured message and code from a modern server", () => {
    const error = apiErrorFromBody(404, { error: "Notification not found", code: "not_found" });
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe("Notification not found");
    expect(error.status).toBe(404);
    expect(error.code).toBe("not_found");
  });

  it("leaves code undefined for bare responses from old servers", () => {
    // Old servers 404 unknown routes with text/plain, so the parsed body is null.
    expect(apiErrorFromBody(404, null)).toMatchObject({
      message: "Request failed (404)",
      status: 404,
      code: undefined,
    });
    // A JSON error without a code (or with a malformed one) is treated the same.
    expect(apiErrorFromBody(404, { error: "Not Found" }).code).toBeUndefined();
    expect(apiErrorFromBody(404, { error: "Not Found", code: 7 }).code).toBeUndefined();
    expect(apiErrorFromBody(500, { nonsense: true }).message).toBe("Request failed (500)");
  });
});

describe("classifyNotificationDetailFailure", () => {
  it("treats a coded 404 as a confirmed missing notification", () => {
    const error = new ApiError("Notification not found", 404, "not_found");
    expect(classifyNotificationDetailFailure(error)).toBe("not_found");
  });

  it("treats an uncoded 404 as a server without the inbox routes", () => {
    expect(classifyNotificationDetailFailure(new ApiError("Request failed (404)", 404))).toBe(
      "unsupported_server",
    );
    expect(classifyNotificationDetailFailure(new ApiError("Not Found", 404, "other_code"))).toBe(
      "unsupported_server",
    );
  });

  it("classifies everything else as transient and retryable", () => {
    expect(classifyNotificationDetailFailure(new ApiError("Server error", 500))).toBe("transient");
    expect(classifyNotificationDetailFailure(new ApiError("Unauthorized", 401))).toBe("transient");
    expect(classifyNotificationDetailFailure(new TypeError("Network request failed"))).toBe(
      "transient",
    );
    expect(classifyNotificationDetailFailure(undefined)).toBe("transient");
  });
});
