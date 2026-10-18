import { describe, expect, it } from "vitest";
import { changedServiceFields, serviceFieldErrors } from "./service-form";

describe("changedServiceFields", () => {
  const service = {
    title: "Deploys",
    imageUrl: "https://localhost/legacy.png",
    url: "https://example.com/deploys",
  };

  it("omits unchanged values, including a legacy image URL", () => {
    expect(
      changedServiceFields(service, {
        title: " Deploys ",
        imageUrl: "https://localhost/legacy.png",
        url: "https://example.com/deploys",
      }),
    ).toEqual({});
  });

  it("includes changed fields and represents an explicit clear as null", () => {
    expect(
      changedServiceFields(service, {
        title: "Deploy bot",
        imageUrl: "https://localhost/legacy.png",
        url: "",
      }),
    ).toEqual({ title: "Deploy bot", url: null });
  });
});

describe("serviceFieldErrors", () => {
  it("maps serialized validation issues to known service fields", () => {
    expect(
      serviceFieldErrors([
        { path: ["imageUrl"], message: "Must be a public HTTPS URL" },
        { path: ["unknown"], message: "Ignore this" },
      ]),
    ).toEqual({ imageUrl: "Must be a public HTTPS URL" });
  });
});
