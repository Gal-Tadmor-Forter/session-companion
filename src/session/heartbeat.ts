import * as fs from "node:fs/promises";
import * as path from "node:path";

const HEARTBEAT_INTERVAL_MS = 5000;
const STALE_AFTER_MS = 10000;

interface HeartbeatFile {
  pid: number;
  updatedAt: number;
}

/** Writes a periodic heartbeat file for the current session while a turn is in flight, so
 * other windows watching the same `~/.claude` data can tell this session is actively responding. */
export class HeartbeatWriter {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly dir: string,
    private readonly sessionId: () => string | undefined
  ) {}

  start(): void {
    if (this.timer) {
      return;
    }
    this.tick();
    this.timer = setInterval(() => this.tick(), HEARTBEAT_INTERVAL_MS);
  }

  /** Writes immediately, e.g. right when the session id becomes known mid-turn. */
  pulse(): void {
    this.tick();
  }

  /** Whether a turn is currently in flight for THIS process (mirrors `start()`/
   * `stop()`'s lifetime) — an in-process equivalent of `isSessionActive()` below, for
   * callers that already hold the live `AgentSession` and don't need the cross-process
   * file check. */
  isRunning(): boolean {
    return this.timer !== undefined;
  }

  private tick(): void {
    const id = this.sessionId();
    if (id) {
      void this.write(id);
    }
  }

  private async write(id: string): Promise<void> {
    try {
      await fs.mkdir(this.dir, { recursive: true });
      const payload: HeartbeatFile = { pid: process.pid, updatedAt: Date.now() };
      await fs.writeFile(path.join(this.dir, `${id}.json`), JSON.stringify(payload));
    } catch {
      // best-effort liveness signal; failures here shouldn't affect the conversation
    }
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    const id = this.sessionId();
    if (id) {
      await fs.unlink(path.join(this.dir, `${id}.json`)).catch(() => undefined);
    }
  }
}

export async function isSessionActive(dir: string, sessionId: string): Promise<boolean> {
  try {
    const raw = await fs.readFile(path.join(dir, `${sessionId}.json`), "utf-8");
    const data = JSON.parse(raw) as HeartbeatFile;
    return Date.now() - data.updatedAt < STALE_AFTER_MS;
  } catch {
    return false;
  }
}

/** Best-effort cleanup of heartbeat files left behind by a crashed extension host. */
export async function sweepStaleHeartbeats(dir: string): Promise<void> {
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return;
  }
  await Promise.all(
    files.map(async (file) => {
      const full = path.join(dir, file);
      try {
        const raw = await fs.readFile(full, "utf-8");
        const data = JSON.parse(raw) as HeartbeatFile;
        if (Date.now() - data.updatedAt >= STALE_AFTER_MS) {
          await fs.unlink(full);
        }
      } catch {
        await fs.unlink(full).catch(() => undefined);
      }
    })
  );
}
