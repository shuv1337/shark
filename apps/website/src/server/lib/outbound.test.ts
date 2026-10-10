import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { ClientRequest, IncomingMessage } from "node:http";
import { createServer, type RequestOptions, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  isPublicAddress,
  outbound,
  pinAddress,
  postCallback,
  type RequestFn,
  type ResolvedAddress,
} from "./outbound";

const PUBLIC_V4 = "93.184.216.34";
const PUBLIC_V6 = "2606:4700:4700::1111";

const BLOCKED = [
  "0.0.0.0",
  "0.1.2.3",
  "10.0.0.1",
  "100.64.0.1",
  "100.127.255.254",
  "127.0.0.1",
  "169.254.169.254",
  "172.16.0.1",
  "172.17.0.1",
  "172.31.255.255",
  "192.0.0.8",
  "192.0.2.1",
  "192.88.99.1",
  "192.168.1.1",
  "198.18.0.1",
  "198.19.255.255",
  "198.51.100.1",
  "203.0.113.1",
  "224.0.0.1",
  "239.255.255.250",
  "240.0.0.1",
  "255.255.255.255",
  "::",
  "::1",
  "::ffff:127.0.0.1",
  "::ffff:7f00:1",
  "::ffff:169.254.169.254",
  "::ffff:8.8.8.8",
  "::127.0.0.1",
  "64:ff9b::a00:1",
  "64:ff9b::169.254.169.254",
  "64:ff9b:1::1",
  "100::1",
  "2001::1",
  "2001:2::1",
  "2001:db8::1",
  "2002:a00:1::",
  "2002:7f00:1::1",
  "3fff::1",
  "fc00::1",
  "fd12:3456::1",
  "fe80::1",
  "fe80::1%en0",
  "fec0::1",
  "ff02::1",
];

type Captured = { options: RequestOptions; body: string };

function fakeRequest(status: number | null, captured: Captured[] = []): RequestFn {
  return ((options: RequestOptions, onResponse: (response: IncomingMessage) => void) => {
    const req = new EventEmitter() as EventEmitter & { end: (body: Buffer) => void };
    req.end = (body) => {
      captured.push({ options, body: body.toString() });
      if (status !== null) {
        queueMicrotask(() => onResponse({ statusCode: status, resume() {} } as IncomingMessage));
      }
    };
    options.signal?.addEventListener("abort", () => req.emit("error", new Error("aborted")));
    return req as unknown as ClientRequest;
  }) as RequestFn;
}

function resolvesTo(...addresses: string[]) {
  return vi.fn(
    async (): Promise<ResolvedAddress[]> =>
      addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })),
  );
}

const post = (url = "https://callback.example.test/hook") =>
  postCallback(url, {
    headers: { authorization: "Bearer synthetic-token", "content-type": "application/json" },
    body: JSON.stringify({ ok: true }),
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isPublicAddress", () => {
  it.each(BLOCKED)("rejects %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([
    PUBLIC_V4,
    "8.8.8.8",
    "100.128.0.1",
    "172.32.0.1",
    "198.20.0.1",
    PUBLIC_V6,
    "2a00:1450:4001::200e",
    "64:ff9b::5db8:d822",
    "2002:5db8:d822::1",
  ])("allows %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it("rejects anything that is not an IP", () => {
    expect(isPublicAddress("example.com")).toBe(false);
    expect(isPublicAddress("")).toBe(false);
  });
});

describe("postCallback", () => {
  it.each(BLOCKED.filter((address) => !address.includes("%")))(
    "blocks a public name resolving to %s without connecting",
    async (address) => {
      vi.spyOn(outbound, "resolve").mockImplementation(resolvesTo(address));
      const request = vi.spyOn(outbound, "request").mockImplementation(fakeRequest(204));
      expect(await post()).toEqual({ ok: false, error: "blocked_destination" });
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("blocks mixed public and private records", async () => {
    vi.spyOn(outbound, "resolve").mockImplementation(resolvesTo(PUBLIC_V4, PUBLIC_V6, "10.0.0.7"));
    const request = vi.spyOn(outbound, "request").mockImplementation(fakeRequest(204));
    expect(await post()).toEqual({ ok: false, error: "blocked_destination" });
    expect(request).not.toHaveBeenCalled();
  });

  it("blocks literal private URLs before resolving", async () => {
    const resolve = vi.spyOn(outbound, "resolve");
    const request = vi.spyOn(outbound, "request").mockImplementation(fakeRequest(204));
    for (const url of [
      "https://127.0.0.1/hook",
      "https://[::1]/hook",
      "https://[::ffff:169.254.169.254]/hook",
      "http://callback.example.test/hook",
      "https://localhost/hook",
    ]) {
      expect(await post(url)).toEqual({ ok: false, error: "blocked_destination" });
    }
    expect(resolve).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("connects to the validated IP while keeping the hostname for SNI and Host", async () => {
    const resolve = vi.spyOn(outbound, "resolve").mockImplementation(resolvesTo(PUBLIC_V4));
    const captured: Captured[] = [];
    vi.spyOn(outbound, "request").mockImplementation(fakeRequest(204, captured));
    expect(await post("https://callback.example.test:8443/hook?x=1")).toEqual({ ok: true });
    expect(resolve).toHaveBeenCalledOnce();
    expect(captured).toHaveLength(1);
    expect(captured[0]?.options).toMatchObject({
      method: "POST",
      host: PUBLIC_V4,
      family: 4,
      port: 8443,
      path: "/hook?x=1",
      servername: "callback.example.test",
      agent: false,
    });
    expect(captured[0]?.options.headers).toMatchObject({
      host: "callback.example.test:8443",
      authorization: "Bearer synthetic-token",
    });
    expect(captured[0]?.body).toBe('{"ok":true}');
  });

  it("re-resolves on every attempt, so a rebinding name never reaches the private IP", async () => {
    const resolve = vi
      .spyOn(outbound, "resolve")
      .mockImplementationOnce(resolvesTo(PUBLIC_V4))
      .mockImplementationOnce(resolvesTo("169.254.169.254"));
    const captured: Captured[] = [];
    vi.spyOn(outbound, "request").mockImplementation(fakeRequest(503, captured));
    expect(await post()).toEqual({ ok: false, error: "HTTP 503" });
    expect(await post()).toEqual({ ok: false, error: "blocked_destination" });
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(captured.map((call) => call.options.host)).toEqual([PUBLIC_V4]);
  });

  it("reports coarse error categories without the underlying message", async () => {
    vi.spyOn(outbound, "resolve").mockRejectedValueOnce(
      Object.assign(new Error("getaddrinfo ENOTFOUND internal.corp"), { code: "ENOTFOUND" }),
    );
    expect(await post()).toEqual({ ok: false, error: "network_error" });

    vi.spyOn(outbound, "resolve").mockImplementation(resolvesTo(PUBLIC_V4));
    vi.spyOn(outbound, "request").mockImplementation(((
      _options: RequestOptions,
      _onResponse: unknown,
    ) => {
      const req = new EventEmitter() as EventEmitter & { end: () => void };
      req.end = () =>
        queueMicrotask(() => req.emit("error", new Error("connect ECONNREFUSED 10.1.2.3:443")));
      return req as unknown as ClientRequest;
    }) as RequestFn);
    expect(await post()).toEqual({ ok: false, error: "network_error" });

    vi.spyOn(outbound, "request").mockImplementation(fakeRequest(302));
    expect(await post()).toEqual({ ok: false, error: "HTTP 302" });
  });

  it("times out a hanging resolver or receiver", async () => {
    vi.spyOn(outbound, "resolve").mockImplementation(() => new Promise(() => undefined));
    const options = { headers: {}, body: "{}", timeoutMs: 30 };
    expect(await postCallback("https://callback.example.test/hook", options)).toEqual({
      ok: false,
      error: "timeout",
    });

    vi.spyOn(outbound, "resolve").mockImplementation(resolvesTo(PUBLIC_V4));
    vi.spyOn(outbound, "request").mockImplementation(fakeRequest(null));
    expect(await postCallback("https://callback.example.test/hook", options)).toEqual({
      ok: false,
      error: "timeout",
    });
  });
});

describe("pinAddress", () => {
  it("returns the first record only when every record is allowed", async () => {
    await expect(
      pinAddress("callback.example.test", resolvesTo(PUBLIC_V4, PUBLIC_V6)),
    ).resolves.toEqual({ address: PUBLIC_V4, family: 4 });
    await expect(
      pinAddress("callback.example.test", resolvesTo(PUBLIC_V6, "::ffff:10.0.0.1")),
    ).rejects.toThrow("blocked_destination");
    await expect(pinAddress("callback.example.test", resolvesTo())).rejects.toThrow(
      "blocked_destination",
    );
  });
});

function hasOpenssl() {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe.runIf(hasOpenssl())("postCallback against a local TLS server", () => {
  const HOST = "callback.example.test";
  let dir: string;
  let cert: string;
  let server: Server;
  let port: number;
  const seen: Array<{
    servername: string | undefined;
    host?: string;
    path?: string;
    body: string;
  }> = [];
  let respond: (res: import("node:http").ServerResponse) => void = (res) => res.end();

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "shark-outbound-"));
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-subj",
        `/CN=${HOST}`,
        "-addext",
        `subjectAltName=DNS:${HOST}`,
        "-keyout",
        join(dir, "key.pem"),
        "-out",
        join(dir, "cert.pem"),
      ],
      { stdio: "ignore" },
    );
    cert = readFileSync(join(dir, "cert.pem"), "utf8");
    server = createServer({ key: readFileSync(join(dir, "key.pem")), cert }, (req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        seen.push({
          servername: (req.socket as import("node:tls").TLSSocket).servername || undefined,
          host: req.headers.host,
          path: req.url,
          body,
        });
        respond(res);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });

  afterEach(() => {
    seen.length = 0;
    respond = (res) => res.end();
  });

  // Loopback is allowed only through the test override; the production policy blocks it.
  const deliver = (hostname = HOST) =>
    postCallback(`https://${hostname}:${port}/hook`, {
      headers: { "content-type": "application/json" },
      body: '{"type":"synthetic"}',
      isAllowedAddress: (address) => address === "127.0.0.1",
      ca: cert,
    });

  it("delivers to the pinned IP with the original hostname for SNI, certificate, and Host", async () => {
    vi.spyOn(outbound, "resolve").mockImplementation(resolvesTo("127.0.0.1"));
    respond = (res) => {
      res.statusCode = 204;
      res.end();
    };
    expect(await deliver()).toEqual({ ok: true });
    expect(seen).toEqual([
      { servername: HOST, host: `${HOST}:${port}`, path: "/hook", body: '{"type":"synthetic"}' },
    ]);
  });

  it("fails when the certificate doesn't match the original hostname", async () => {
    vi.spyOn(outbound, "resolve").mockImplementation(resolvesTo("127.0.0.1"));
    expect(await deliver("other.example.test")).toEqual({ ok: false, error: "network_error" });
    expect(seen).toHaveLength(0);
  });

  it("does not follow a redirect, including to a private target", async () => {
    vi.spyOn(outbound, "resolve").mockImplementation(resolvesTo("127.0.0.1"));
    respond = (res) => {
      res.statusCode = 302;
      res.setHeader("location", "https://169.254.169.254/latest/meta-data/");
      res.end();
    };
    expect(await deliver()).toEqual({ ok: false, error: "HTTP 302" });
    expect(seen).toHaveLength(1);
  });

  it("never connects when the production policy sees loopback", async () => {
    vi.spyOn(outbound, "resolve").mockImplementation(resolvesTo("127.0.0.1"));
    const outcome = await postCallback(`https://${HOST}:${port}/hook`, {
      headers: {},
      body: "{}",
      ca: cert,
    });
    expect(outcome).toEqual({ ok: false, error: "blocked_destination" });
    expect(seen).toHaveLength(0);
  });
});
