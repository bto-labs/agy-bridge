import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parseResetDuration,
  formatDuration,
  detectQuota,
  QuotaError,
  CooldownRegistry,
  DEFAULT_COOLDOWN_SEC,
  slugifyModel,
  defaultCooldownDeps,
  type CooldownStoreDeps,
} from "../src/quota.js";

const LOG_429 =
  "E0613 00:38:03.030151 56767 log.go:398] agent executor error: RESOURCE_EXHAUSTED (code 429): " +
  "Individual quota reached. Contact your administrator to enable overages. Resets in 96h53m25s.: " +
  "RESOURCE_EXHAUSTED (code 429): Individual quota reached.";

describe("parseResetDuration", () => {
  it("parses full h/m/s durations", () => {
    expect(parseResetDuration("96h53m25s")).toBe(96 * 3600 + 53 * 60 + 25);
  });
  it("parses partial durations", () => {
    expect(parseResetDuration("4h24m")).toBe(4 * 3600 + 24 * 60);
    expect(parseResetDuration("30s")).toBe(30);
    expect(parseResetDuration("5m")).toBe(300);
  });
  it("returns undefined for garbage", () => {
    expect(parseResetDuration("soon")).toBeUndefined();
    expect(parseResetDuration("")).toBeUndefined();
  });
});

describe("formatDuration", () => {
  it("formats seconds into h/m/s", () => {
    expect(formatDuration(348805)).toBe("96h53m25s");
    expect(formatDuration(300)).toBe("5m");
    expect(formatDuration(0)).toBe("0s");
  });
});

describe("detectQuota", () => {
  it("detects a 429 line and extracts the reset time", () => {
    const q = detectQuota(LOG_429);
    expect(q).not.toBeNull();
    expect(q!.resetText).toBe("96h53m25s");
    expect(q!.resetSeconds).toBe(348805);
  });
  it("detects a 429 even without a reset time", () => {
    const q = detectQuota("RESOURCE_EXHAUSTED (code 429): quota reached");
    expect(q).not.toBeNull();
    expect(q!.resetSeconds).toBeUndefined();
  });
  it("returns null on a clean log", () => {
    expect(detectQuota("I0613 print mode: sending message\nall good")).toBeNull();
  });
});

describe("QuotaError", () => {
  it("carries model and reset info in the message", () => {
    const e = new QuotaError("Gemini 3.5 Flash (Medium)", {
      resetText: "4h24m",
      resetSeconds: 15840,
    });
    expect(e.message).toContain("Gemini 3.5 Flash (Medium)");
    expect(e.message).toContain("4h24m");
    expect(e.resetSeconds).toBe(15840);
  });
});

/** In-memory fake store — no real filesystem I/O, for fast unit tests. */
function fakeCooldownDeps(): CooldownStoreDeps {
  const store = new Map<string, number>();
  return {
    async readDeadline(model) {
      return store.get(model);
    },
    async writeDeadline(model, untilMs) {
      store.set(model, untilMs);
    },
  };
}

describe("CooldownRegistry", () => {
  it("marks a model as cooling until its reset time", async () => {
    let now = 1_000_000;
    const reg = new CooldownRegistry(() => now, fakeCooldownDeps());
    await reg.set("ModelA", 60);
    expect(await reg.cooling("ModelA")).toBe(true);
    expect(await reg.cooling("ModelB")).toBe(false);
    now += 61_000;
    expect(await reg.cooling("ModelA")).toBe(false);
  });

  it("falls back to a default cooldown when reset time is unknown", async () => {
    let now = 0;
    const reg = new CooldownRegistry(() => now, fakeCooldownDeps());
    await reg.set("ModelA", undefined);
    now = (DEFAULT_COOLDOWN_SEC - 1) * 1000;
    expect(await reg.cooling("ModelA")).toBe(true);
    now = (DEFAULT_COOLDOWN_SEC + 1) * 1000;
    expect(await reg.cooling("ModelA")).toBe(false);
  });

  it("describes remaining cooldown", async () => {
    const reg = new CooldownRegistry(() => 0, fakeCooldownDeps());
    await reg.set("ModelA", 3661);
    expect(await reg.describe("ModelA")).toBe("1h1m1s");
  });

  it("never lets a shorter cooldown shorten an existing longer one", async () => {
    let now = 0;
    const reg = new CooldownRegistry(() => now, fakeCooldownDeps());
    await reg.set("ModelA", 3600); // a 1h daily-quota cooldown lands first
    await reg.set("ModelA", 60); // a racing 1m rate-limit cooldown must not win
    now = 61_000; // the 1m cooldown would have expired by now...
    expect(await reg.cooling("ModelA")).toBe(true); // ...but the 1h one is still active
  });

  it("does let a longer cooldown extend an existing shorter one", async () => {
    let now = 0;
    const reg = new CooldownRegistry(() => now, fakeCooldownDeps());
    await reg.set("ModelA", 60);
    await reg.set("ModelA", 3600);
    now = 61_000;
    expect(await reg.cooling("ModelA")).toBe(true);
  });

  it("shares cooldown state across independently constructed registries on the same store", async () => {
    const deps = fakeCooldownDeps();
    const writer = new CooldownRegistry(() => 0, deps);
    const reader = new CooldownRegistry(() => 0, deps);
    await writer.set("ModelA", 60);
    expect(await reader.cooling("ModelA")).toBe(true);
  });
});

describe("slugifyModel", () => {
  it("lowercases and collapses non-alphanumeric runs into a single dash", () => {
    expect(slugifyModel("Gemini 3.1 Pro (High)")).toBe("gemini-3-1-pro-high");
  });

  it("trims leading and trailing dashes", () => {
    expect(slugifyModel("--weird--")).toBe("weird");
  });

  it("falls back to a stable name for an all-symbol input", () => {
    expect(slugifyModel("???")).toBe("model");
  });
});

describe("defaultCooldownDeps", () => {
  function withTempDir(fn: (dir: string) => Promise<void>) {
    return async () => {
      const dir = mkdtempSync(path.join(tmpdir(), "agy-bridge-cooldown-test-"));
      try {
        await fn(dir);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };
  }

  it(
    "returns undefined for a model with no recorded deadline",
    withTempDir(async (dir) => {
      const deps = defaultCooldownDeps(dir);
      expect(await deps.readDeadline("Gemini 3.1 Pro (High)")).toBeUndefined();
    }),
  );

  it(
    "round-trips a deadline through the real filesystem",
    withTempDir(async (dir) => {
      const deps = defaultCooldownDeps(dir);
      const until = Date.now() + 60_000;
      await deps.writeDeadline("Gemini 3.1 Pro (High)", until);
      const read = await deps.readDeadline("Gemini 3.1 Pro (High)");
      expect(read).toBeDefined();
      expect(Math.abs(read! - until)).toBeLessThan(1500); // mtime resolution varies by fs
    }),
  );

  it(
    "shares state across two independent deps instances pointed at the same directory",
    withTempDir(async (dir) => {
      const a = defaultCooldownDeps(dir);
      const b = defaultCooldownDeps(dir);
      const until = Date.now() + 60_000;
      await a.writeDeadline("ModelA", until);
      const read = await b.readDeadline("ModelA");
      expect(read).toBeDefined();
      expect(Math.abs(read! - until)).toBeLessThan(1500);
    }),
  );

  it(
    "creates the target directory tree if it doesn't exist yet",
    withTempDir(async (dir) => {
      const nested = path.join(dir, "nested", "cooldowns");
      const deps = defaultCooldownDeps(nested);
      await deps.writeDeadline("ModelA", Date.now() + 1000);
      expect(await deps.readDeadline("ModelA")).toBeDefined();
    }),
  );
});
