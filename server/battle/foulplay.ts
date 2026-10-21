import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

/** The engine's p2 stream: protocol chunks out, choices in. */
export interface PlayerStream extends AsyncIterable<string> {
  write(data: string): unknown;
}

interface Request {
  wait?: boolean;
  teamPreview?: boolean;
  forceSwitch?: boolean[];
  active?: Array<{ moves: Array<{ id: string; disabled?: boolean | string }>; trapped?: boolean }>;
  side: { pokemon: Array<{ condition: string; active: boolean }> };
}

const AI_DIR = fileURLToPath(new URL("../../../ai/", import.meta.url));

function botPaths() {
  return {
    python: process.env.REDBOT_PYTHON ?? join(AI_DIR, "venv/bin/python"),
    script: process.env.REDBOT_SCRIPT ?? join(AI_DIR, "redbot.py"),
    foulPlay: process.env.FOULPLAY_DIR ?? join(AI_DIR, "foul-play"),
  };
}

/** True when ai/setup.sh (or the Docker image) has put Foul Play in place. */
export function foulPlayAvailable(): boolean {
  const { python, script, foulPlay } = botPaths();
  return [python, script, join(foulPlay, "fp")].every((p) => existsSync(p));
}

/** Every choice the engine would accept for this request, as "move N" / "switch N". */
export function legalChoices(request: Request): string[] {
  if (request.wait || request.teamPreview) return [];
  const switches = request.side.pokemon.flatMap((p, i) =>
    !p.active && !p.condition.endsWith(" fnt") ? [`switch ${i + 1}`] : []
  );
  if (request.forceSwitch) return switches;
  const active = request.active?.[0];
  if (!active) return [];
  const moves = active.moves.flatMap((m, i) => (m.disabled ? [] : [`move ${i + 1}`]));
  return active.trapped ? moves : [...moves, ...switches];
}

/** Foul Play names moves ("move thunder"); the stored form is the slot ("move 1"). */
function canonicalChoice(request: Request, choice: string): string {
  const named = /^move (?!\d+$)(.+)$/.exec(choice);
  if (!named) return choice;
  const slot = request.active?.[0]?.moves.findIndex((m) => m.id === named[1]) ?? -1;
  return slot >= 0 ? `move ${slot + 1}` : choice;
}

function randomLegal(request: Request, exclude?: string): string {
  const options = legalChoices(request).filter((c) => c !== exclude);
  return options.length ? options[Math.floor(Math.random() * options.length)] : "default";
}

export interface RedPlayerOptions {
  /** 0 (near random) to 1 (full strength); see ai/redbot.py. */
  difficulty: number;
  seed: number;
  /** Choices Red already made in this battle, answered without asking the bot. */
  replay: string[];
  /** Called with each new choice, so it can be stored. */
  record(choice: string): void;
  /** Called when the engine rejected the last recorded choice. */
  retract(): void;
  turnTimeoutMs?: number;
}

/**
 * Red, played by Foul Play in a child process (ai/redbot.py). The bot sees
 * the same protocol a Showdown client would; every choice is checked against
 * the request before it reaches the engine. If the bot is missing, crashes,
 * is too slow or picks something illegal, Red plays a random legal move
 * instead, so a battle can never stall.
 */
export class RedPlayer {
  private child?: ChildProcess;
  private botAlive = false;
  private replay: string[];
  private pending: { request: Request; timer: NodeJS.Timeout } | null = null;
  private lastRequest: Request | null = null;
  private lastChoice = "";
  private lastWasLive = false;
  private rejections = 0;
  private stopped = false;

  constructor(
    private readonly stream: PlayerStream,
    private readonly opts: RedPlayerOptions
  ) {
    this.replay = [...opts.replay];
  }

  async start(): Promise<void> {
    this.spawnBot();
    for await (const chunk of this.stream) {
      if (this.stopped) break;
      this.onChunk(chunk);
    }
    this.destroy();
  }

  destroy(): void {
    this.stopped = true;
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = null;
    this.child?.kill();
  }

  private spawnBot(): void {
    const { python, script } = botPaths();
    const child = spawn(
      python,
      [script, "--difficulty", String(this.opts.difficulty), "--seed", String(this.opts.seed)],
      { stdio: ["pipe", "pipe", "inherit"] }
    );
    this.child = child;
    this.botAlive = true;
    child.on("error", () => this.botDied());
    child.on("exit", () => this.botDied());
    child.stdin!.on("error", () => {});
    createInterface({ input: child.stdout! }).on("line", (line) => this.onBotLine(line));
  }

  private botDied(): void {
    if (!this.botAlive) return;
    this.botAlive = false;
    if (this.pending && !this.stopped) {
      console.warn("Red's bot stopped; playing a random move");
      this.answer(randomLegal(this.pending.request));
    }
  }

  private send(message: object): void {
    if (this.botAlive) this.child?.stdin?.write(JSON.stringify(message) + "\n");
  }

  private onChunk(chunk: string): void {
    if (chunk.startsWith("|error|")) {
      this.onRejected();
      return;
    }
    if (!chunk.startsWith("|request|")) {
      this.send({ chunk });
      return;
    }
    const request: Request = JSON.parse(chunk.slice("|request|".length));
    if (request.wait || request.teamPreview) {
      this.send({ chunk });
      return;
    }
    const known = this.replay.shift();
    if (known !== undefined) {
      this.lastRequest = request;
      this.lastChoice = known;
      this.lastWasLive = false;
      this.send({ chunk, answer: known });
      void this.stream.write(known);
      return;
    }
    if (this.pending) clearTimeout(this.pending.timer);
    const timer = setTimeout(() => {
      console.warn("Red's bot timed out; playing a random move");
      this.answer(randomLegal(request));
    }, this.opts.turnTimeoutMs ?? Number(process.env.FOULPLAY_TURN_TIMEOUT_MS ?? 10_000));
    this.pending = { request, timer };
    this.send({ chunk });
    if (!this.botAlive) this.answer(randomLegal(request));
  }

  private onBotLine(line: string): void {
    if (!this.pending) return;
    const { request } = this.pending;
    let choice: string;
    try {
      choice = canonicalChoice(request, JSON.parse(line).choice);
    } catch {
      return;
    }
    if (!legalChoices(request).includes(choice)) {
      console.warn(`Red's bot chose an illegal move (${choice}); playing a random move`);
      choice = randomLegal(request);
    }
    this.answer(choice);
  }

  private answer(choice: string): void {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.lastRequest = this.pending.request;
    this.pending = null;
    this.rejections = 0;
    this.commit(choice);
  }

  private commit(choice: string): void {
    this.lastChoice = choice;
    this.lastWasLive = true;
    this.opts.record(choice);
    void this.stream.write(choice);
  }

  /** The engine refused Red's last choice: forget it and try another. */
  private onRejected(): void {
    if (!this.lastRequest || this.stopped) return;
    if (this.lastWasLive) this.opts.retract();
    const retry =
      this.rejections++ < 3 ? randomLegal(this.lastRequest, this.lastChoice) : "default";
    this.commit(retry);
  }
}
