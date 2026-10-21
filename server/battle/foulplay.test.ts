import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { legalChoices, RedPlayer, type RedPlayerOptions } from "./foulplay.js";

/** Answers every decision request with $STUB_CHOICE; stays silent if $STUB_SILENT is set. */
const STUB = `
import readline from "node:readline";
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const { chunk, answer } = JSON.parse(line);
  if (!chunk.startsWith("|request|") || answer !== undefined) return;
  if (JSON.parse(chunk.slice(9)).wait || process.env.STUB_SILENT) return;
  console.log(JSON.stringify({ choice: process.env.STUB_CHOICE }));
});
`;

class FakeStream implements AsyncIterable<string> {
  writes: string[] = [];
  private queue: string[] = [];
  private wake?: () => void;
  private closed = false;
  push(chunk: string) {
    this.queue.push(chunk);
    this.wake?.();
  }
  end() {
    this.closed = true;
    this.wake?.();
  }
  write(data: string) {
    this.writes.push(data);
  }
  async *[Symbol.asyncIterator]() {
    for (;;) {
      if (this.queue.length) yield this.queue.shift()!;
      else if (this.closed) return;
      else await new Promise<void>((resolve) => (this.wake = resolve));
    }
  }
}

const request = (extra: object = {}) =>
  "|request|" +
  JSON.stringify({
    active: [{ moves: [{ id: "thunder" }, { id: "quickattack" }] }],
    side: {
      pokemon: [
        { condition: "100/100", active: true },
        { condition: "100/100", active: false },
        { condition: "0 fnt", active: false },
      ],
    },
    ...extra,
  });

let stubPath: string;
beforeAll(() => {
  stubPath = join(mkdtempSync(join(tmpdir(), "redbot-")), "stub.mjs");
  writeFileSync(stubPath, STUB);
});

const players: RedPlayer[] = [];
afterEach(() => {
  for (const p of players.splice(0)) p.destroy();
  vi.restoreAllMocks();
});

function setup(env: Record<string, string>, opts: Partial<RedPlayerOptions> = {}) {
  process.env.REDBOT_PYTHON = process.execPath;
  process.env.REDBOT_SCRIPT = stubPath;
  delete process.env.STUB_SILENT;
  Object.assign(process.env, env);
  const stream = new FakeStream();
  const recorded: string[] = [];
  const retracted = vi.fn();
  const player = new RedPlayer(stream, {
    difficulty: 1,
    seed: 1,
    replay: [],
    record: (c) => recorded.push(c),
    retract: retracted,
    ...opts,
  });
  players.push(player);
  void player.start();
  return { stream, recorded, retracted };
}

describe("legalChoices", () => {
  it("lists enabled moves and healthy bench Pokemon", () => {
    expect(legalChoices(JSON.parse(request().slice(9)))).toEqual(["move 1", "move 2", "switch 2"]);
  });

  it("only offers switches when forced, and no switches when trapped", () => {
    expect(legalChoices(JSON.parse(request({ forceSwitch: [true], active: undefined }).slice(9)))).toEqual([
      "switch 2",
    ]);
    const trapped = { active: [{ moves: [{ id: "a", disabled: true }, { id: "b" }], trapped: true }] };
    expect(legalChoices(JSON.parse(request(trapped).slice(9)))).toEqual(["move 2"]);
  });

  it("offers nothing while waiting", () => {
    expect(legalChoices(JSON.parse(request({ wait: true }).slice(9)))).toEqual([]);
  });
});

describe("RedPlayer", () => {
  it("plays the bot's choice, as a slot, and records it", async () => {
    const { stream, recorded } = setup({ STUB_CHOICE: "move quickattack" });
    stream.push("|turn|1");
    stream.push(request());
    await vi.waitFor(() => expect(stream.writes).toEqual(["move 2"]));
    expect(recorded).toEqual(["move 2"]);
  });

  it("replaces an illegal choice with a legal one", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { stream, recorded } = setup({ STUB_CHOICE: "switch 3" });
    stream.push(request());
    await vi.waitFor(() => expect(stream.writes).toHaveLength(1));
    expect(["move 1", "move 2", "switch 2"]).toContain(stream.writes[0]);
    expect(recorded).toEqual(stream.writes);
  });

  it("answers from stored choices first, then asks the bot", async () => {
    const { stream, recorded } = setup({ STUB_CHOICE: "move thunder" }, { replay: ["move 2"] });
    stream.push(request());
    await vi.waitFor(() => expect(stream.writes).toEqual(["move 2"]));
    expect(recorded).toEqual([]);
    stream.push(request());
    await vi.waitFor(() => expect(stream.writes).toEqual(["move 2", "move 1"]));
    expect(recorded).toEqual(["move 1"]);
  });

  it("does not answer wait requests", async () => {
    const { stream } = setup({ STUB_CHOICE: "move 1" });
    stream.push(request({ wait: true }));
    stream.push(request());
    await vi.waitFor(() => expect(stream.writes).toEqual(["move 1"]));
  });

  it("plays a random legal move when the bot cannot be started", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { stream, recorded } = setup({ REDBOT_PYTHON: "/nonexistent/python" });
    stream.push(request());
    await vi.waitFor(() => expect(stream.writes).toHaveLength(1));
    expect(["move 1", "move 2", "switch 2"]).toContain(stream.writes[0]);
    expect(recorded).toEqual(stream.writes);
  });

  it("plays a random legal move when the bot is too slow", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { stream } = setup({ STUB_SILENT: "1", STUB_CHOICE: "move 1" }, { turnTimeoutMs: 100 });
    stream.push(request());
    await vi.waitFor(() => expect(stream.writes).toHaveLength(1));
  });

  it("takes back a choice the engine rejects and tries another", async () => {
    const { stream, recorded, retracted } = setup({ STUB_CHOICE: "move 1" });
    stream.push(request());
    await vi.waitFor(() => expect(stream.writes).toEqual(["move 1"]));
    stream.push("|error|[Unavailable choice] Can't move");
    await vi.waitFor(() => expect(stream.writes).toHaveLength(2));
    expect(retracted).toHaveBeenCalledTimes(1);
    expect(stream.writes[1]).not.toBe("move 1");
    expect(recorded).toEqual(stream.writes);
  });
});
