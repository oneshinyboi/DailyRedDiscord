import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BattleSession, beginSession, shutdownSessions } from "./session.js";
import { findSessionById, initStore } from "./store.js";

/** A bot that always asks for the first move; forced switches fall back to a random legal one. */
const STUB = `
import readline from "node:readline";
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const { chunk, answer } = JSON.parse(line);
  if (!chunk.startsWith("|request|") || answer !== undefined) return;
  if (JSON.parse(chunk.slice(9)).wait) return;
  console.log(JSON.stringify({ choice: "move 1" }));
});
`;

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "redbot-"));
  writeFileSync(join(dir, "stub.mjs"), STUB);
  process.env.REDBOT_PYTHON = process.execPath;
  process.env.REDBOT_SCRIPT = join(dir, "stub.mjs");
  process.env.RED_AI = "foulplay";
});

beforeEach(() => {
  process.env.DB_PATH = ":memory:";
  initStore();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  shutdownSessions();
  vi.restoreAllMocks();
});

afterAll(() => {
  delete process.env.RED_AI;
});

describe("a Foul Play battle", () => {
  it("is rebuilt from stored choices without asking the bot again", async () => {
    const { session } = await beginSession("u1", "UTC", 1);
    expect(session.ai).toBe("foulplay");
    await session.ready();
    for (let i = 0; i < 3 && !session.ended; i++) await session.choose("move 1");

    const rec = findSessionById(session.id)!;
    expect(rec.ai).toBe("foulplay");
    expect(rec.aiChoices.length).toBeGreaterThan(0);

    // A bot that would play differently if it were consulted
    process.env.REDBOT_SCRIPT = "/nonexistent.mjs";
    const restored = await BattleSession.restore(rec);
    expect(restored.history()).toEqual(session.history());
    expect(findSessionById(session.id)!.aiChoices).toEqual(rec.aiChoices);
    restored.destroy();
  });
});
