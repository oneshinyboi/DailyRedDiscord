import { randomUUID } from "node:crypto";
import ps from "pokemon-showdown";
import randomPlayerAiModule from "pokemon-showdown/dist/sim/tools/random-player-ai.js";
import type { PokemonSet } from "pokemon-showdown/dist/sim/teams.js";
import type { PRNGSeed } from "pokemon-showdown/dist/sim/prng.js";
import type { ChoiceRequest } from "pokemon-showdown/dist/sim/side.js";
import { RED_TEAM } from "./red.js";
import { dailySeeds } from "./seed.js";
import { generateDailyTeam } from "./teamgen.js";

const { BattleStream, getPlayerStreams, Teams } = ps;
const { RandomPlayerAI } = randomPlayerAiModule;

const FORMAT = "gen3customgame";
const CHOICE_RE = /^(move|switch|team|pass|auto)( |$)/;
const FIRST_REQUEST_TIMEOUT = 5_000;
const CHOICE_TIMEOUT = 3_000;
const SESSION_TTL = 2 * 60 * 60_000;

export interface BattleSnapshot {
  /** Showdown protocol lines since the previous snapshot */
  lines: string[];
  /** The pending |request| the client must answer, if any */
  request: ChoiceRequest | null;
  ended: boolean;
  winner: string | null;
}

/**
 * One authoritative battle between the human (p1) and Red (p2).
 *
 * The engine runs entirely in this process. The p1 stream carries exactly
 * what the challenger is allowed to see (fog-of-war filtered protocol lines
 * plus their private |request|/|error| updates); Red is driven by an AI
 * attached to the p2 stream. Deterministic end to end for a given
 * (date, timezone) seed.
 */
export class BattleSession {
  readonly id: string;
  /** Discord user id of the challenger; only they may drive this battle. */
  readonly ownerId: string;
  readonly date: string;
  readonly playerTeam: PokemonSet[];

  private stream: InstanceType<typeof BattleStream>;
  private pendingLines: string[] = [];
  private fullLog: string[] = [];
  private currentRequest: ChoiceRequest | null = null;
  private version = 0;
  private waiters: Array<() => void> = [];
  private dead = false;
  lastTouched = Date.now();
  ended = false;
  winner: string | null = null;

  constructor(ownerId: string, timeZone: string) {
    const seeds = dailySeeds(timeZone);
    this.id = randomUUID();
    this.ownerId = ownerId;
    this.date = seeds.date;
    this.playerTeam = generateDailyTeam(seeds.teamSeed);

    this.stream = new BattleStream();
    const streams = getPlayerStreams(this.stream);
    const ai = new RandomPlayerAI(streams.p2, { seed: seeds.aiSeed });
    void ai.start();

    this.pump(streams.p1);
    this.drain(streams.omniscient);

    void this.stream.write(
      `>start ${JSON.stringify({ formatid: FORMAT, seed: seeds.battleSeed })}`
    );
    void this.stream.write(
      `>player p1 ${JSON.stringify({
        name: "Challenger",
        team: Teams.pack(this.playerTeam),
      })}`
    );
    void this.stream.write(
      `>player p2 ${JSON.stringify({
        name: "Red",
        team: Teams.pack(RED_TEAM),
      })}`
    );
  }

  /** Client-visible lines from the p1 stream (requests/errors included). */
  private async pump(stream: AsyncIterable<string>): Promise<void> {
    try {
      for await (const chunk of stream) {
        for (const line of chunk.split("\n")) {
          if (line.startsWith("|request|")) {
            this.currentRequest = JSON.parse(line.slice(9));
            this.bump();
          } else if (line.startsWith("|win|")) {
            this.winner = line.slice(5);
            this.ended = true;
            this.pushLine(line);
          } else if (line === "|tie" || line === "|tie|") {
            this.winner = null;
            this.ended = true;
            this.pushLine(line);
          } else if (line.startsWith("|error|")) {
            this.pushLine(line);
            this.bump();
          } else {
            this.pushLine(line);
          }
        }
      }
    } catch {
      // stream torn down mid-battle; treat as ended
    }
    this.ended = this.ended || this.winner !== null;
    this.bump();
  }

  /** Omniscient stream is consumed only so its buffer never grows. */
  private async drain(stream: AsyncIterable<string>): Promise<void> {
    try {
      for await (const _chunk of stream) {
        /* discard */
      }
    } catch {
      /* battle over */
    }
  }

  private pushLine(line: string): void {
    if (line.startsWith("|t:|") || line.startsWith("|debug|")) return;
    this.pendingLines.push(line);
    this.fullLog.push(line);
  }

  private bump(): void {
    this.version++;
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve();
  }

  private waitForChange(baseline: number, timeout: number): Promise<void> {
    if (this.version !== baseline || this.ended) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== done);
        done();
      }, timeout);
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      this.waiters.push(done);
    });
  }

  /** Apply a player choice ("move 1", "switch 2", ...) and snapshot. */
  async choose(choice: string): Promise<BattleSnapshot & { error?: string }> {
    this.lastTouched = Date.now();
    if (this.dead || this.ended) throw new Error("battle already ended");
    if (!CHOICE_RE.test(choice)) throw new Error("invalid choice format");

    const baseline = this.version;
    const before = this.fullLog.length;
    await this.stream.write(`>p1 ${choice}`);
    await this.waitForChange(baseline, CHOICE_TIMEOUT);

    const snapshot = this.snapshot();
    const errorLine = snapshot.lines.find((l) => l.startsWith("|error|"));
    return { ...snapshot, error: errorLine?.slice(7) };
  }

  /** Wait until the battle has produced its first request (or ended). */
  async ready(): Promise<BattleSnapshot> {
    if (!this.currentRequest && !this.ended) {
      await this.waitForChange(this.version, FIRST_REQUEST_TIMEOUT);
    }
    return this.snapshot();
  }

  snapshot(): BattleSnapshot {
    this.lastTouched = Date.now();
    const lines = this.pendingLines;
    this.pendingLines = [];
    return {
      lines,
      request: this.ended ? null : this.currentRequest,
      ended: this.ended,
      winner: this.winner,
    };
  }

  /** Full client-visible history (for reconnects). */
  history(): { date: string; team: PokemonSet[]; lines: string[] } & BattleSnapshot {
    const { request, ended, winner } = this.snapshot();
    return {
      date: this.date,
      team: this.playerTeam,
      lines: this.fullLog,
      request,
      ended,
      winner,
    };
  }

  destroy(): void {
    this.dead = true;
    this.ended = true;
    this.bump();
    void this.stream.writeEnd();
  }
}

const sessions = new Map<string, BattleSession>();
const byOwner = new Map<string, BattleSession>();

/**
 * Creates today's battle for the user. Users only ever have one active
 * battle: starting anew silently replaces (and destroys) the previous one.
 */
export function createSession(ownerId: string, timeZone: string): BattleSession {
  const previous = byOwner.get(ownerId);
  if (previous) {
    previous.destroy();
    sessions.delete(previous.id);
    byOwner.delete(ownerId);
  }
  const session = new BattleSession(ownerId, timeZone);
  sessions.set(session.id, session);
  byOwner.set(ownerId, session);
  return session;
}

/** Fetches a battle only if it exists AND belongs to the given user. */
export function getSessionFor(
  ownerId: string,
  battleId: string
): BattleSession | undefined {
  const session = sessions.get(battleId);
  return session?.ownerId === ownerId ? session : undefined;
}

function sweep(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastTouched > SESSION_TTL) {
      session.destroy();
      sessions.delete(id);
      byOwner.delete(session.ownerId);
    }
  }
}

const sweeper = setInterval(sweep, 10 * 60_000);
sweeper.unref();
