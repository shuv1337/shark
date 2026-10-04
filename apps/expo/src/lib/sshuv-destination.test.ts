import { describe, expect, it } from "vitest";
import { parseSshuvDestination } from "./sshuv-destination";

const prefix = "https://app.example.test/conversation/v1/";
const reference = "synthetic_reference_1234567890";

describe("SSHuv destination validation", () => {
  it("requires explicit operator configuration", () => {
    expect(parseSshuvDestination(`${prefix}${reference}`, undefined)).toBeNull();
    expect(parseSshuvDestination(`${prefix}${reference}`, "")).toBeNull();
  });

  it("returns only a canonical URL and bounded opaque reference", () => {
    expect(parseSshuvDestination(`${prefix}${reference}`, prefix)).toEqual({
      url: `${prefix}${reference}`,
      reference,
    });
    expect(parseSshuvDestination(`${prefix}${"a".repeat(22)}`, prefix)).not.toBeNull();
    expect(parseSshuvDestination(`${prefix}${"a".repeat(128)}`, prefix)).not.toBeNull();
  });

  it.each([
    `http://app.example.test/conversation/v1/${reference}`,
    `https://app.example.test.evil.test/conversation/v1/${reference}`,
    `https://app.example.test@evil.test/conversation/v1/${reference}`,
    `https://app.example.test:8443/conversation/v1/${reference}`,
    `https://app.example.test/conversation/v2/${reference}`,
    `https://app.example.test/other/v1/${reference}`,
    `https://app.example.test/../conversation/v1/${reference}`,
    `https://app.example.test/conversation/v1//${reference}`,
    `https://app.example.test/conversation/v1/%61${reference}`,
    `${prefix}${reference}?action=approve`,
    `${prefix}${reference}#command`,
    `${prefix}${reference}/extra`,
    `${prefix}${reference}\\extra`,
    `${prefix}${reference}\n`,
    `${prefix}${"a".repeat(21)}`,
    `${prefix}${"a".repeat(129)}`,
    `${prefix}$(touch file)`,
    `sshuv://${reference}`,
    null,
    {},
  ])("rejects destinations outside the exact namespace: %j", (value) => {
    expect(parseSshuvDestination(value, prefix)).toBeNull();
  });

  it.each([
    "http://app.example.test/conversation/v1/",
    "https://app.example.test/conversation/",
    "https://app.example.test/conversation/v2/",
    "https://app.example.test/conversation/v1",
    "https://app.example.test/conversation/%76%31/",
    "https://app.example.test/conversation/../v1/",
    "https://app.example.test/conversation/v1/?q=",
    "https://app.example.test/conversation/v1/#fragment",
    "https://user:synthetic@app.example.test/conversation/v1/",
    "not a URL",
  ])("fails closed for invalid build configuration: %s", (value) => {
    expect(parseSshuvDestination(`${value}${reference}`, value)).toBeNull();
  });
});
