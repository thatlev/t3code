// @effect-diagnostics nodeBuiltinImport:off - Exercises the real local Unix-socket boundary.
import * as NodeFs from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTimersPromises from "node:timers/promises";
import { describe, expect, it } from "vite-plus/test";

import {
  AgentMicroCompanionFrameDecoder,
  AgentMicroCompanionTransport,
  encodeAgentMicroCompanionFrame,
} from "./AgentMicroCompanionTransport.ts";

async function waitFor(assertion: () => void, timeoutMs = 2_000): Promise<void> {
  const startedAt = process.hrtime.bigint();
  let lastError: unknown;
  while (Number(process.hrtime.bigint() - startedAt) / 1_000_000 < timeoutMs) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await NodeTimersPromises.setTimeout(10);
    }
  }
  throw lastError;
}

describe("AgentMicro companion framing", () => {
  it("decodes fragmented and coalesced frames without losing boundaries", () => {
    const decoder = new AgentMicroCompanionFrameDecoder();
    const presence = encodeAgentMicroCompanionFrame(0x50, Uint8Array.of(1));
    const input = encodeAgentMicroCompanionFrame(0x49, Uint8Array.of(5, 9, 7));
    const bytes = Buffer.concat([presence, input]);

    expect(decoder.push(bytes.subarray(0, 3))).toEqual([]);
    expect(decoder.push(bytes.subarray(3))).toEqual([
      { tag: 0x50, payload: Uint8Array.of(1) },
      { tag: 0x49, payload: Uint8Array.of(5, 9, 7) },
    ]);
  });
});

describe.skipIf(process.platform === "win32")("AgentMicro companion transport", () => {
  it("identifies T3, receives phone state, and sends reports over the shared socket", async () => {
    const temporaryDirectory = await NodeFs.mkdtemp(
      NodePath.join(NodeOS.tmpdir(), "t3-agent-micro-transport-"),
    );
    const socketPath = NodePath.join(temporaryDirectory, "companion.sock");
    const receivedFrames: Array<{ readonly tag: number; readonly payload: Uint8Array }> = [];
    const states: Array<{
      readonly companionConnected: boolean;
      readonly phoneConnected: boolean;
    }> = [];
    const inputs: Uint8Array[] = [];
    const clients: NodeNet.Socket[] = [];
    const server = NodeNet.createServer((socket) => {
      clients.push(socket);
      const decoder = new AgentMicroCompanionFrameDecoder();
      socket.on("data", (chunk) => receivedFrames.push(...decoder.push(chunk)));
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });

    const transport = new AgentMicroCompanionTransport({
      socketPath,
      onState: (state) => states.push(state),
      onInput: (report) => inputs.push(report),
      reconnectDelayMs: () => 5,
    });

    try {
      transport.start();
      await waitFor(() => {
        expect(states.at(-1)?.companionConnected).toBe(true);
        expect(receivedFrames).toContainEqual({
          tag: 0x54,
          payload: new TextEncoder().encode("t3code"),
        });
      });

      clients[0]?.write(encodeAgentMicroCompanionFrame(0x50, Uint8Array.of(1)));
      clients[0]?.write(encodeAgentMicroCompanionFrame(0x49, Uint8Array.of(6, 5, 4)));
      await waitFor(() => {
        expect(states.at(-1)?.phoneConnected).toBe(true);
        expect(inputs).toContainEqual(Uint8Array.of(6, 5, 4));
      });

      expect(transport.send(Uint8Array.of(6, 3, 2, 1))).toBe(true);
      await waitFor(() => {
        expect(receivedFrames).toContainEqual({
          tag: 0x4f,
          payload: Uint8Array.of(6, 3, 2, 1),
        });
      });
    } finally {
      transport.stop();
      for (const client of clients) client.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await NodeFs.rm(temporaryDirectory, { recursive: true });
    }
  });
});
