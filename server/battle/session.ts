import { randomUUID } from "node:crypto";
import ps from "pokemon-showdown";
import randomPlayerAiModule from "pokemon-showdown/dist/sim/tools/random-player-ai.js";
import type { PokemonSet } from "pokemon-showdown/dist/sim/teams.js";
import type { PRNGSeed } from "pokemon-showdown/dist/sim/prng.js";
import type { ChoiceRequest } from "pokemon-showdown/dist/sim/side.js";
import { RED_TEAM } from "./red.js";
import { dailySeeds, DailySeeds } from "./seed.js";
import { generateDailyTeam } from "./teamgen.js";

const { BattleStream, getPlayerStreams, Teams } = ps;
const { RandomPlayerAI } = randomPlayerAiModule;

const FORMAT = "gen3customgame";
const CHOICE_RE = /^(move|switch|team|pass|auto)( |$)/;
const FIRST_REQUEST_TIMEOUT = 5_000;
const CHOICE_TIMEOUT = 3_000;

export type BattlePhase = "battling" | "ended";

export interface BattleSnapshot {
  /** Where the session is: in progress or over */
  phase: BattlePhase;
  /** Showdown protocol lines since the previous snapshot */
  lines: string[];
  /** The pending |request| the client must answer, if any */
  request: ChoiceRequest | null;
  ended: boolean;
  winner: string | null;
}

/**
 * One authoritative battle between the human (p1) and Red (p2), begun with
 * a chosen lead and bound to a single local date (the "daily").
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
  /** Local calendar date (YYYY-MM-DD) this daily belongs to. */
  readonly date: string;
  readonly playerTeam: PokemonSet[];

  private stream: InstanceType<typeof BattleStream>;
  private seeds: DailySeeds;
  private pendingLines: string[] = [];
  private fullLog: string[] = [];
  private currentRequest: ChoiceRequest | null = null;
  private version = 0;
  private waiters: Array<() => void> = [];
  private dead = false;
  ended = false;
  winner: string | null = null;

  get phase(): BattlePhase {
    return this.dead || this.ended ? "ended" : "battling";
  }

  /**
   * A session exists only for a begun battle: the lead slot (1-based) is
   * supplied here, reordered to the front (gens 1-3 lead with team slot 1),
   * and the engine starts immediately.
   */
  constructor(ownerId: string, timeZone: string, leadSlot: number) {
    if (!Number.isInteger(leadSlot) || leadSlot < 1 || leadSlot > 6) {
      throw new Error("invalid lead slot");
    }
    this.seeds = dailySeeds(timeZone);
    this.id = randomUUID();
    this.ownerId = ownerId;
    this.date = this.seeds.date;
    this.playerTeam = generateDailyTeam(this.seeds.teamSeed);
    const [lead] = this.playerTeam.splice(leadSlot - 1, 1);
    this.playerTeam.unshift(lead);

    this.stream = new BattleStream();
    const streams = getPlayerStreams(this.stream);
    const ai = new RandomPlayerAI(streams.p2, { seed: this.seeds.aiSeed });
    void ai.start();

    this.pump(streams.p1);
    this.drain(streams.omniscient);
    void this.startEngine();
  }

  /** Feeds the battle its format and both players. */
  private async startEngine(): Promise<void> {
    await this.stream.write(
      `>start ${JSON.stringify({ formatid: FORMAT, seed: this.seeds.battleSeed })}`
    );
    await this.stream.write(
      `>player p1 ${JSON.stringify({
        name: "Challenger",
        team: Teams.pack(this.playerTeam),
      })}`
    );
    await this.stream.write(
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
    if (this.dead || this.ended) throw new Error("battle already ended");
    if (!CHOICE_RE.test(choice)) throw new Error("invalid choice format");

    const baseline = this.version;
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
    const lines = this.pendingLines;
    this.pendingLines = [];
    return {
      phase: this.phase,
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
      phase: this.phase,
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
/** userId -> local date -> that day's session (one battle per date) */
const byOwner = new Map<string, Map<string, BattleSession>>();

/** A user's session for a specific local date, if they have begun one. */
export function getDailySession(
  ownerId: string,
  date: string
): BattleSession | undefined {
  return byOwner.get(ownerId)?.get(date);
}

/** Upper bound on concurrent sessions per user (evicts oldest date). */
const MAX_SESSIONS_PER_USER = 4;

/**
 * Begins the user's battle for the given timezone's today, with their chosen
 * lead. The caller checks getDailySession() first; this always creates a new
 * session and registers it synchronously, so concurrent begins cannot race.
 */
export function createSession(
  ownerId: string,
  timeZone: string,
  leadSlot: number
): BattleSession {
  const session = new BattleSession(ownerId, timeZone, leadSlot);
  sessions.set(session.id, session);
  let dated = byOwner.get(ownerId);
  if (!dated) {
    dated = new Map();
    byOwner.set(ownerId, dated);
  }
  dated.set(session.date, session);
  if (dated.size > MAX_SESSIONS_PER_USER) {
    // ISO dates sort chronologically; evict the oldest
    const oldest = [...dated.keys()].sort()[0];
    const evicted = dated.get(oldest)!;
    dated.delete(oldest);
    sessions.delete(evicted.id);
    evicted.destroy();
  }
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
