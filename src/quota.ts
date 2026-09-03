/**
 * Quota detection and cooldown tracking for agy model failover.
 *
 * agy never surfaces RESOURCE_EXHAUSTED to stdout/stderr in print mode — it
 * silently retries until --print-timeout, then exits 0 with empty output.
 * The only reliable signal is the 429 line in its log file, which includes
 * the exact reset time ("Resets in 96h53m25s").
 */

import { mkdir, open, stat, utimes } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export const DEFAULT_COOLDOWN_SEC = 15 * 60;

const QUOTA_RE = /RESOURCE_EXHAUSTED \(code 429\)/;
const RESET_RE = /Resets in ((?:\d+h)?(?:\d+m)?(?:\d+s)?)\b/;

export interface QuotaInfo {
  resetText?: string;
  resetSeconds?: number;
}

export function parseResetDuration(text: string): number | undefined {
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(text);
  if (!m || (!m[1] && !m[2] && !m[3])) return undefined;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  let out = "";
  if (h) out += `${h}h`;
  if (m) out += `${m}m`;
  if (sec || !out) out += `${sec}s`;
  return out;
}

export function detectQuota(log: string): QuotaInfo | null {
  if (!QUOTA_RE.test(log)) return null;
  const reset = RESET_RE.exec(log)?.[1];
  const resetSeconds = reset ? parseResetDuration(reset) : undefined;
  return { resetText: resetSeconds !== undefined ? reset : undefined, resetSeconds };
}

export class QuotaError extends Error {
  readonly resetSeconds?: number;
  readonly resetText?: string;

  constructor(
    readonly model: string | undefined,
    info: QuotaInfo,
  ) {
    const who = model ?? "agy's default model";
    const when = info.resetText ? ` Quota resets in ${info.resetText}.` : "";
    super(`Quota exhausted for ${who} (RESOURCE_EXHAUSTED 429).${when}`);
    this.name = "QuotaError";
    this.resetSeconds = info.resetSeconds;
    this.resetText = info.resetText;
  }
}

/**
 * Backing store for cross-process cooldown sharing. Every method must resolve
 * (never reject) — a failure to read or persist a cooldown is a lost
 * optimization, not something that may ever break real delegation.
 */
export interface CooldownStoreDeps {
  /** Resolves the recorded deadline (epoch ms) for `model`, or undefined if none. */
  readDeadline(model: string): Promise<number | undefined>;
  /** Records `untilMs` as the deadline for `model`. */
  writeDeadline(model: string, untilMs: number): Promise<void>;
}

export const DEFAULT_COOLDOWN_DIR = path.join(homedir(), ".cache", "agy-bridge", "cooldowns");

/** Maps a model name to a filesystem-safe token; collapses to "model" if nothing survives. */
export function slugifyModel(model: string): string {
  return (
    model
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "model"
  );
}

async function ensureDir(dir: string): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
  } catch (err) {
    // mkdir(..., {recursive: true}) already tolerates an existing directory;
    // this only guards exotic OS/filesystem combinations that don't.
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
}

/**
 * One file per model, keyed by the file's own mtime — no JSON, no temp files,
 * no rename. `utimes`/`stat` are single-syscall metadata operations, atomic
 * by construction: a concurrent reader always observes either the fully-old
 * or fully-new deadline, never a partial write.
 */
export function defaultCooldownDeps(dir: string = DEFAULT_COOLDOWN_DIR): CooldownStoreDeps {
  const filePath = (model: string) => path.join(dir, `${slugifyModel(model)}.cooldown`);

  return {
    async readDeadline(model) {
      try {
        return (await stat(filePath(model))).mtimeMs;
      } catch {
        return undefined;
      }
    },
    async writeDeadline(model, untilMs) {
      try {
        await ensureDir(dir);
        const file = filePath(model);
        const handle = await open(file, "a"); // create-if-missing, never truncates
        await handle.close();
        const when = new Date(untilMs);
        await utimes(file, when, when);
      } catch {
        // best-effort persistence — a write failure must never break delegation
      }
    },
  };
}

export class CooldownRegistry {
  constructor(
    private now: () => number = Date.now,
    private deps: CooldownStoreDeps = defaultCooldownDeps(),
  ) {}

  async set(model: string, resetSeconds: number | undefined): Promise<void> {
    const until = this.now() + (resetSeconds ?? DEFAULT_COOLDOWN_SEC) * 1000;
    const existing = await this.deps.readDeadline(model);
    if (existing !== undefined && existing >= until) return; // never shorten a live cooldown
    await this.deps.writeDeadline(model, until);
  }

  async cooling(model: string): Promise<boolean> {
    const t = await this.deps.readDeadline(model);
    return t !== undefined && t > this.now();
  }

  async describe(model: string): Promise<string> {
    const t = await this.deps.readDeadline(model);
    return formatDuration(t === undefined ? 0 : (t - this.now()) / 1000);
  }
}
