import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HeartbeatWriter, isSessionActive, sweepStaleHeartbeats } from "../heartbeat";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "heartbeat-test-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("isSessionActive", () => {
  it("is false when no heartbeat file exists", async () => {
    expect(await isSessionActive(dir, "missing-session")).toBe(false);
  });

  it("is true for a heartbeat written moments ago", async () => {
    await fs.writeFile(
      path.join(dir, "abc.json"),
      JSON.stringify({ pid: 1, updatedAt: Date.now() })
    );
    expect(await isSessionActive(dir, "abc")).toBe(true);
  });

  it("is false for a stale heartbeat", async () => {
    await fs.writeFile(
      path.join(dir, "abc.json"),
      JSON.stringify({ pid: 1, updatedAt: Date.now() - 60_000 })
    );
    expect(await isSessionActive(dir, "abc")).toBe(false);
  });

  it("is false for a corrupt heartbeat file", async () => {
    await fs.writeFile(path.join(dir, "abc.json"), "not json");
    expect(await isSessionActive(dir, "abc")).toBe(false);
  });
});

describe("HeartbeatWriter", () => {
  it("does nothing on tick when the session id is not yet known", async () => {
    const writer = new HeartbeatWriter(dir, () => undefined);
    writer.pulse();
    await new Promise((r) => setTimeout(r, 20));
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it("pulse() writes the heartbeat file immediately", async () => {
    const writer = new HeartbeatWriter(dir, () => "session-1");
    writer.pulse();
    await new Promise((r) => setTimeout(r, 20));
    expect(await isSessionActive(dir, "session-1")).toBe(true);
  });

  it("stop() removes the heartbeat file", async () => {
    const writer = new HeartbeatWriter(dir, () => "session-1");
    writer.pulse();
    await new Promise((r) => setTimeout(r, 20));
    await writer.stop();
    expect(await isSessionActive(dir, "session-1")).toBe(false);
  });

  it("stop() is a no-op when nothing was ever written", async () => {
    const writer = new HeartbeatWriter(dir, () => "session-1");
    await expect(writer.stop()).resolves.toBeUndefined();
  });
});

describe("sweepStaleHeartbeats", () => {
  it("removes only stale heartbeat files", async () => {
    await fs.writeFile(
      path.join(dir, "fresh.json"),
      JSON.stringify({ pid: 1, updatedAt: Date.now() })
    );
    await fs.writeFile(
      path.join(dir, "stale.json"),
      JSON.stringify({ pid: 1, updatedAt: Date.now() - 60_000 })
    );
    await sweepStaleHeartbeats(dir);
    expect((await fs.readdir(dir)).sort()).toEqual(["fresh.json"]);
  });

  it("removes corrupt files it can't parse", async () => {
    await fs.writeFile(path.join(dir, "corrupt.json"), "{not json");
    await sweepStaleHeartbeats(dir);
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it("does nothing when the directory does not exist", async () => {
    await expect(sweepStaleHeartbeats(path.join(dir, "missing"))).resolves.toBeUndefined();
  });
});
