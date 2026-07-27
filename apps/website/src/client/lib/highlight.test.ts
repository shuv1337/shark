import { describe, expect, it } from "vitest";
import { type Token, tokenizeJson, tokenizeShell } from "./highlight";

/** Highlighting must never alter the code it displays. */
function assertLossless(source: string, tokens: Token[]) {
  expect(tokens.map((token) => token.text).join("")).toBe(source);
}

function kindOf(tokens: Token[], text: string): string | undefined {
  return tokens.find((token) => token.text === text)?.kind;
}

describe("tokenizeJson", () => {
  it("distinguishes keys from string values", () => {
    const source = '{\n  "body": "Deployed",\n  "delivered": 1\n}';
    const tokens = tokenizeJson(source);

    assertLossless(source, tokens);
    expect(kindOf(tokens, '"body"')).toBe("key");
    expect(kindOf(tokens, '"Deployed"')).toBe("string");
    expect(kindOf(tokens, "1")).toBe("number");
  });

  it("tags literals, negative numbers, and punctuation", () => {
    const source = '{"ok": true, "missing": null, "delta": -12.5e3, "list": []}';
    const tokens = tokenizeJson(source);

    assertLossless(source, tokens);
    expect(kindOf(tokens, "true")).toBe("literal");
    expect(kindOf(tokens, "null")).toBe("literal");
    expect(kindOf(tokens, "-12.5e3")).toBe("number");
    expect(kindOf(tokens, "{")).toBe("punct");
  });

  it("keeps escaped quotes inside a single string token", () => {
    const source = '{"body": "say \\"hi\\" now"}';
    const tokens = tokenizeJson(source);

    assertLossless(source, tokens);
    expect(kindOf(tokens, '"say \\"hi\\" now"')).toBe("string");
  });

  it("does not lose an unterminated string", () => {
    const source = '{"body": "oops';
    assertLossless(source, tokenizeJson(source));
  });

  it("does not treat a colon inside a string as a key delimiter", () => {
    const source = '{"url": "https://example.com/a"}';
    const tokens = tokenizeJson(source);

    assertLossless(source, tokens);
    expect(kindOf(tokens, '"https://example.com/a"')).toBe("string");
  });
});

describe("tokenizeShell", () => {
  const curl = `curl -X POST https://shark.shuv.dev/hooks/whk_token \\
  -H 'Content-Type: application/json' \\
  -d '{
    "body": "Production deployed successfully.",
    "title": "GitHub"
  }'`;

  it("labels the command, flags, and url", () => {
    const tokens = tokenizeShell(curl);

    assertLossless(curl, tokens);
    expect(kindOf(tokens, "curl")).toBe("command");
    expect(kindOf(tokens, "-X")).toBe("flag");
    expect(kindOf(tokens, "https://shark.shuv.dev/hooks/whk_token")).toBe("url");
    expect(kindOf(tokens, "'Content-Type: application/json'")).toBe("string");
  });

  it("highlights a quoted JSON body as JSON rather than one flat string", () => {
    const tokens = tokenizeShell(curl);

    expect(kindOf(tokens, '"body"')).toBe("key");
    expect(kindOf(tokens, '"GitHub"')).toBe("string");
  });

  it("treats a continued line as arguments, not a new command", () => {
    const tokens = tokenizeShell(curl);
    const commands = tokens.filter((token) => token.kind === "command");

    expect(commands).toHaveLength(1);
  });

  it("starts a new command after a real newline", () => {
    const source = "curl https://a.test\necho done";
    const tokens = tokenizeShell(source);

    assertLossless(source, tokens);
    expect(kindOf(tokens, "echo")).toBe("command");
  });

  it("tags comments to end of line only", () => {
    const source = "# create a service\ncurl https://a.test";
    const tokens = tokenizeShell(source);

    assertLossless(source, tokens);
    expect(kindOf(tokens, "# create a service")).toBe("comment");
    expect(kindOf(tokens, "curl")).toBe("command");
  });

  it("does not lose an unterminated quote", () => {
    const source = "curl -d 'oops";
    assertLossless(source, tokenizeShell(source));
  });

  it("emits no empty tokens", () => {
    for (const token of tokenizeShell(curl)) expect(token.text).not.toBe("");
  });
});
