import type { Http2Server, IncomingHttpHeaders, ServerHttp2Stream } from "node:http2";
import { createServer } from "node:http2";
import type { Server as NetServer } from "node:net";
import { createServer as createNetServer } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apnsConnection, sendApnsPayload } from "./apns";

function listen(server: NetServer | Http2Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("test server did not bind a TCP port"));
        return;
      }
      resolve(address.port);
    });
  });
}

describe("APNs session connect errors", () => {
  const sessions: ReturnType<typeof apnsConnection.open>[] = [];
  const sessionErrors: Array<{ code?: string }> = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const session of sessions) {
      if (!session.destroyed) session.destroy();
    }
    sessions.length = 0;
    sessionErrors.length = 0;
  });

  it("fails one refused send on the session and opens a new session for the next send", async () => {
    const realOpen = apnsConnection.open.bind(apnsConnection);
    vi.spyOn(apnsConnection, "open").mockImplementation((authority, options) => {
      const session = realOpen(authority, options);
      const emit = session.emit;
      // Record the session's own error event without handling it. A missing
      // production listener still throws from EventEmitter.
      session.emit = function (this: typeof session, event: string | symbol, ...args: unknown[]) {
        if (event === "error" && args[0] instanceof Error) {
          const error = args[0] as NodeJS.ErrnoException;
          sessionErrors.push({ code: error.code });
        }
        return emit.apply(this, [event, ...args] as never);
      } as typeof session.emit;
      sessions.push(session);
      return session;
    });

    const probe = createNetServer();
    const refusedPort = await listen(probe);
    await new Promise<void>((resolve) => {
      probe.close(() => resolve());
    });

    const server = createServer();
    const paths: string[] = [];
    server.on("stream", (stream: ServerHttp2Stream, headers: IncomingHttpHeaders) => {
      paths.push(String(headers[":path"]));
      stream.respond({ ":status": 200 });
      stream.end();
    });
    const openPort = await listen(server);

    const uncaught: unknown[] = [];
    const onUncaught = (error: unknown) => {
      uncaught.push(error);
    };
    process.on("uncaughtException", onUncaught);
    const headers = { ":method": "POST", ":path": "/3/device/synthetic" };
    const payload = Buffer.from("{}");
    try {
      const refused = await sendApnsPayload(
        "production",
        headers,
        payload,
        `http://127.0.0.1:${refusedPort}`,
      );
      expect(refused).toMatchObject({ accepted: false, status: 0 });
      expect(refused.reason).toContain("ECONNREFUSED");
      expect(refused.reason).toContain("127.0.0.1");
      expect(sessionErrors).toContainEqual({ code: "ECONNREFUSED" });
      expect(sessions).toHaveLength(1);

      const next = await sendApnsPayload(
        "production",
        headers,
        payload,
        `http://127.0.0.1:${openPort}`,
      );
      expect(next).toMatchObject({ accepted: true, status: 200 });
      expect(sessions).toHaveLength(2);
      expect(sessions[1]).not.toBe(sessions[0]);
      expect(sessions[0]?.destroyed).toBe(true);
      expect(paths).toEqual(["/3/device/synthetic"]);
      expect(apnsConnection.open).toHaveBeenNthCalledWith(
        1,
        `http://127.0.0.1:${refusedPort}`,
        expect.objectContaining({ family: 4 }),
      );
      expect(apnsConnection.open).toHaveBeenNthCalledWith(
        2,
        `http://127.0.0.1:${openPort}`,
        expect.objectContaining({ family: 4 }),
      );
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(uncaught).toEqual([]);
    } finally {
      process.removeListener("uncaughtException", onUncaught);
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });
});
