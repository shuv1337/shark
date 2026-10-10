import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { ClientRequest, IncomingMessage } from "node:http";
import {
  createServer,
  request as httpsRequest,
  type RequestOptions,
  type Server,
} from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkServerIdentity } from "node:tls";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  isPublicAddress,
  outbound,
  pinAddresses,
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
  "5f00::1",
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

type FakeReq = EventEmitter & { end: (body: Buffer) => void; destroy: () => void };

/** `status` is an HTTP status, null to hang, or an errno code to fail before any response. */
function fakeRequest(status: number | string | null, captured: Captured[] = []): RequestFn {
  return ((options: RequestOptions, onResponse: (response: IncomingMessage) => void) => {
    const req = new EventEmitter() as FakeReq;
    req.destroy = () => undefined;
    req.end = (body) => {
      captured.push({ options, body: body.toString() });
      if (typeof status === "number") {
        const response = Object.assign(new EventEmitter(), { statusCode: status });
        queueMicrotask(() => onResponse(response as unknown as IncomingMessage));
      } else if (typeof status === "string") {
        const error = Object.assign(new Error(`connect ${status}`), { code: status });
        queueMicrotask(() => req.emit("error", error));
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

    vi.spyOn(outbound, "request").mockImplementation(fakeRequest("ECONNREFUSED"));
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

describe("postCallback dual-stack failover", () => {
  it("tries the next validated address in resolver order when a connect fails", async () => {
    vi.spyOn(outbound, "resolve").mockImplementation(resolvesTo(PUBLIC_V6, PUBLIC_V4));
    const captured: Captured[] = [];
    let calls = 0;
    vi.spyOn(outbound, "request").mockImplementation(((options, onResponse) =>
      fakeRequest(calls++ === 0 ? "ENETUNREACH" : 204, captured)(
        options,
        onResponse,
      )) as RequestFn);
    expect(await post()).toEqual({ ok: true });
    expect(captured.map((call) => [call.options.host, call.options.family])).toEqual([
      [PUBLIC_V6, 6],
      [PUBLIC_V4, 4],
    ]);
    expect(captured.every((call) => call.options.servername === "callback.example.test")).toBe(
      true,
    );
  });

  it("stops at the first HTTP status or non-connect error", async () => {
    vi.spyOn(outbound, "resolve").mockImplementation(resolvesTo(PUBLIC_V6, PUBLIC_V4));
    const captured: Captured[] = [];
    vi.spyOn(outbound, "request").mockImplementation(fakeRequest(503, captured));
    expect(await post()).toEqual({ ok: false, error: "HTTP 503" });
    expect(captured).toHaveLength(1);

    for (const code of ["ECONNRESET", "ETIMEDOUT"]) {
      captured.length = 0;
      vi.spyOn(outbound, "request").mockImplementation(fakeRequest(code, captured));
      expect(await post()).toEqual({ ok: false, error: "network_error" });
      expect(captured).toHaveLength(1);
    }
  });

  it("ignores errors emitted after the status arrives", async () => {
    vi.spyOn(outbound, "resolve").mockImplementation(resolvesTo(PUBLIC_V6, PUBLIC_V4));
    const captured: Captured[] = [];
    vi.spyOn(outbound, "request").mockImplementation(((options, onResponse) => {
      const req = fakeRequest(503, captured)(options, onResponse) as unknown as FakeReq;
      req.destroy = () => {
        const error = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
        queueMicrotask(() => req.emit("error", error));
      };
      return req as unknown as ClientRequest;
    }) as RequestFn);
    expect(await post()).toEqual({ ok: false, error: "HTTP 503" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(captured).toHaveLength(1);
  });

  it("reports the last connect error when every address fails", async () => {
    vi.spyOn(outbound, "resolve").mockImplementation(resolvesTo(PUBLIC_V6, PUBLIC_V4));
    const captured: Captured[] = [];
    vi.spyOn(outbound, "request").mockImplementation(fakeRequest("ECONNREFUSED", captured));
    expect(await post()).toEqual({ ok: false, error: "network_error" });
    expect(captured).toHaveLength(2);
  });

  it("does not fail over once the overall deadline has passed", async () => {
    vi.spyOn(outbound, "resolve").mockImplementation(resolvesTo(PUBLIC_V6, PUBLIC_V4));
    const captured: Captured[] = [];
    vi.spyOn(outbound, "request").mockImplementation(fakeRequest(null, captured));
    const outcome = await postCallback("https://callback.example.test/hook", {
      headers: {},
      body: "{}",
      timeoutMs: 30,
    });
    expect(outcome).toEqual({ ok: false, error: "timeout" });
    expect(captured).toHaveLength(1);
  });

  it("keeps the overall deadline when a fast connect error precedes a hanging address", async () => {
    vi.spyOn(outbound, "resolve").mockImplementation(resolvesTo(PUBLIC_V6, PUBLIC_V4));
    const captured: Captured[] = [];
    let calls = 0;
    vi.spyOn(outbound, "request").mockImplementation(((options, onResponse) =>
      fakeRequest(calls++ === 0 ? "ECONNREFUSED" : null, captured)(
        options,
        onResponse,
      )) as RequestFn);
    const started = Date.now();
    const outcome = await postCallback("https://callback.example.test/hook", {
      headers: {},
      body: "{}",
      timeoutMs: 50,
    });
    expect(outcome).toEqual({ ok: false, error: "timeout" });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(captured.map((call) => call.options.host)).toEqual([PUBLIC_V6, PUBLIC_V4]);
  });
});

describe("pinAddresses", () => {
  it("returns every record, in order, only when every record is allowed", async () => {
    await expect(
      pinAddresses("callback.example.test", resolvesTo(PUBLIC_V4, PUBLIC_V6)),
    ).resolves.toEqual([
      { address: PUBLIC_V4, family: 4 },
      { address: PUBLIC_V6, family: 6 },
    ]);
    await expect(
      pinAddresses("callback.example.test", resolvesTo(PUBLIC_V6, "::ffff:10.0.0.1")),
    ).rejects.toThrow("blocked_destination");
    await expect(pinAddresses("callback.example.test", resolvesTo())).rejects.toThrow(
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

const opensslAvailable = hasOpenssl();
if (!opensslAvailable && process.env.CI) {
  throw new Error("openssl is required in CI for the local TLS server tests");
}

describe.runIf(opensslAvailable)("postCallback against a local TLS server", () => {
  const HOST = "callback.example.test";
  const LITERAL = PUBLIC_V4;
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
  let lastSocket: import("node:net").Socket | undefined;

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
        `subjectAltName=DNS:${HOST},IP:${LITERAL}`,
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
      lastSocket = req.socket;
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
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });

  afterEach(() => {
    seen.length = 0;
    respond = (res) => res.end();
    lastSocket = undefined;
  });

  /** Trusts the test certificate; the production request function has no extra trust anchor. */
  const trustingRequest = (overrides: RequestOptions = {}): RequestFn =>
    ((options, onResponse) =>
      httpsRequest({ ...options, ca: cert, ...overrides }, onResponse)) as RequestFn;

  // Loopback is allowed only through the test seam; the production policy blocks it.
  const deliver = (hostname = HOST) => {
    vi.spyOn(outbound, "isAllowedAddress").mockImplementation((address) => address === "127.0.0.1");
    vi.spyOn(outbound, "request").mockImplementation(trustingRequest());
    return postCallback(`https://${hostname}:${port}/hook`, {
      headers: { "content-type": "application/json" },
      body: '{"type":"synthetic"}',
    });
  };

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

  it("closes the connection once the status arrives, even if the body never ends", async () => {
    vi.spyOn(outbound, "resolve").mockImplementation(resolvesTo("127.0.0.1"));
    respond = (res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.write("partial body that never ends");
    };
    expect(await deliver()).toEqual({ ok: true });
    const socket = lastSocket;
    if (!socket) throw new Error("Expected a server-side socket");
    if (!socket.destroyed) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("server socket stayed open")), 1_000);
        socket.once("close", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    expect(socket.destroyed).toBe(true);
  });

  it("delivers to a public IP literal with certificate verification against that IP", async () => {
    const resolve = vi.spyOn(outbound, "resolve");
    const pinned: RequestOptions[] = [];
    // The seam can't route a public IP to loopback, so redirect the socket and
    // verify the certificate against the address postCallback chose.
    vi.spyOn(outbound, "request").mockImplementation(((options: RequestOptions, onResponse) => {
      pinned.push(options);
      return trustingRequest({
        host: "127.0.0.1",
        family: 4,
        checkServerIdentity: (_host, peer) => checkServerIdentity(String(options.host), peer),
      })(options, onResponse);
    }) as RequestFn);
    respond = (res) => {
      res.statusCode = 204;
      res.end();
    };
    expect(
      await postCallback(`https://${LITERAL}:${port}/hook`, {
        headers: { "content-type": "application/json" },
        body: '{"type":"synthetic"}',
      }),
    ).toEqual({ ok: true });
    expect(resolve).not.toHaveBeenCalled();
    expect(pinned).toEqual([
      expect.objectContaining({ host: LITERAL, family: 4, servername: undefined }),
    ]);
    expect(pinned[0]?.headers).toMatchObject({ host: `${LITERAL}:${port}` });
    expect(seen).toEqual([
      {
        servername: undefined,
        host: `${LITERAL}:${port}`,
        path: "/hook",
        body: '{"type":"synthetic"}',
      },
    ]);
  });

  it("never connects when the production policy sees loopback", async () => {
    vi.spyOn(outbound, "resolve").mockImplementation(resolvesTo("127.0.0.1"));
    vi.spyOn(outbound, "request").mockImplementation(trustingRequest());
    const outcome = await postCallback(`https://${HOST}:${port}/hook`, {
      headers: {},
      body: "{}",
    });
    expect(outcome).toEqual({ ok: false, error: "blocked_destination" });
    expect(seen).toHaveLength(0);
  });
});
