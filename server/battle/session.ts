import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import ps from "pokemon-showdown";
import randomPlayerAiModule from "pokemon-showdown/dist/sim/tools/random-player-ai.js";
import type { PokemonSet } from "pokemon-showdown/dist/sim/teams.js";
import type { PRNGSeed } from "pokemon-showdown/dist/sim/prng.js";
import type {
  BattleHistory,
  BattlePhase,
  BattleSnapshot,
  ChoiceRequest,
  ChoiceResponse,
  StreakInfo,
} from "@dailyred/shared";
import { RED_TEAM } from "./red.js";
import { dailySeedsForDate, DailySeeds, todayInTimeZone } from "./seed.js";
import { generateDailyTeam } from "./teamgen.js";
import * as store from "./store.js";

const require = createRequire(import.meta.url);
const { BattleStream, getPlayerStreams, Teams } = ps;
const { RandomPlayerAI } = randomPlayerAiModule;

const FORMAT = "gen3customgame";
const PLAYER_NAME = "Challenger";
const CHOICE_RE = /^(move|switch|team|pass|auto)( |$)/;

function isWaitRequest(request: ChoiceRequest | null): boolean {
  return request !== null && "wait" in request && request.wait === true;
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

  private stream?: InstanceType<typeof BattleStream>;
  private seeds: DailySeeds;
  private pendingLines: string[] = [];
  private fullLog: string[] = [];
  private currentRequest: ChoiceRequest | null = null;
  private version = 0;
  private waiters: Array<() => void> = [];
  private dead = false;
  private replaying = false;
  /** A |win| or |tie| was seen (as opposed to the session being torn down). */
  private concluded = false;
  private finalized = false;
  private queue: Promise<unknown> = Promise.resolve();
  ended = false;
  winner: string | null = null;

  get phase(): BattlePhase {
    return this.dead || this.ended ? "ended" : "battling";
  }

  /**
   * A session exists only for a begun battle: the lead slot (1-based) is
   * supplied here, reordered to the front (gens 1-3 lead with team slot 1),
   * and the engine starts immediately.
   *
   * `opts` is for rebuilding a stored session: its id and date are reused
   * (seeds derive from the stored date, not today), and a `frozen` session is
   * one that already ended, so it only carries its final log and no engine.
   */
  constructor(
    ownerId: string,
    timeZone: string,
    leadSlot: number,
    opts: {
      id?: string;
      date?: string;
      frozen?: { winner: string | null; log: string[] };
    } = {}
  ) {
    if (!Number.isInteger(leadSlot) || leadSlot < 1 || leadSlot > 6) {
      throw new Error("invalid lead slot");
    }
    this.seeds = dailySeedsForDate(opts.date ?? todayInTimeZone(timeZone));
    this.id = opts.id ?? randomUUID();
    this.ownerId = ownerId;
    this.date = this.seeds.date;
    this.playerTeam = generateDailyTeam(this.seeds.teamSeed);
    const [lead] = this.playerTeam.splice(leadSlot - 1, 1);
    this.playerTeam.unshift(lead);

    if (opts.frozen) {
      this.ended = true;
      this.finalized = true;
      this.winner = opts.frozen.winner;
      this.fullLog = opts.frozen.log;
      return;
    }

    this.stream = new BattleStream();
    const streams = getPlayerStreams(this.stream);
    const ai = new RandomPlayerAI(streams.p2, { seed: this.seeds.aiSeed });
    void ai.start().catch(() => this.destroy());

    this.pump(streams.p1);
    this.drain(streams.omniscient);
    void this.startEngine().catch(() => this.destroy());
  }

  /** Feeds the battle its format and both players. */
  private async startEngine(): Promise<void> {
    const stream = this.stream!;
    await stream.write(
      `>start ${JSON.stringify({ formatid: FORMAT, seed: this.seeds.battleSeed })}`
    );
    await stream.write(
      `>player p1 ${JSON.stringify({
        name: PLAYER_NAME,
        team: Teams.pack(this.playerTeam),
      })}`
    );
    await stream.write(
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
            this.concluded = true;
            this.pushLine(line);
          } else if (line === "|tie" || line === "|tie|") {
            this.winner = null;
            this.ended = true;
            this.concluded = true;
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
    this.finalize();
    this.bump();
  }

  /** Stores the result and updates streaks, once, when the battle concludes. */
  private finalize(): void {
    if (!this.concluded || this.finalized) return;
    this.finalized = true;
    try {
      store.finishSession({
        id: this.id,
        ownerId: this.ownerId,
        date: this.date,
        winner: this.winner,
        won: this.winner === PLAYER_NAME,
        log: this.fullLog,
      });
    } catch (err) {
      console.error(`failed to persist result of battle ${this.id}`, err);
    }
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

  private waitForNextChange(baseline: number): Promise<void> {
    if (this.version !== baseline || this.ended) return Promise.resolve();
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  /**
   * Apply a player choice ("move 1", "switch 2", ...) and snapshot. Calls on
   * one session run one at a time so the stored choice order is the real one.
   */
  choose(choice: string): Promise<ChoiceResponse> {
    const run = this.queue.then(() => this.applyChoice(choice));
    this.queue = run.catch(() => {});
    return run;
  }

  private async applyChoice(choice: string): Promise<ChoiceResponse> {
    if (this.dead || this.ended) throw new Error("battle already ended");
    if (!CHOICE_RE.test(choice)) throw new Error("invalid choice format");

    const baseline = this.version;
    await this.stream!.write(`>p1 ${choice}`);
    await this.waitForNextChange(baseline);

    // Resolving on the first bump can return a wait request (Red's Pokemon
    // fainted and the AI must switch). The client can't answer those, so keep
    // waiting until it's the challenger's turn again (or the battle ends).
    while (!this.ended && isWaitRequest(this.currentRequest)) {
      await this.waitForNextChange(this.version);
    }

    const snapshot = this.snapshot();
    const errorLine = snapshot.lines.find((l) => l.startsWith("|error|"));
    // Rejected choices don't change the battle, so only accepted ones are
    // stored for replay.
    if (!errorLine && !this.replaying) store.appendChoice(this.id, choice);
    this.finalize();
    return {
      ...snapshot,
      error: errorLine?.slice(7),
      streak: store.getStreak(this.ownerId, this.date),
    };
  }

  /**
   * Rebuilds a stored session. An ended one is restored from its saved log;
   * an active one has its accepted choices replayed into a fresh engine,
   * which is deterministic because the battle and Red's AI are seeded.
   */
  static async restore(rec: store.SessionRecord): Promise<BattleSession> {
    if (rec.ended) {
      return new BattleSession(rec.ownerId, rec.timeZone, rec.leadSlot, {
        id: rec.id,
        date: rec.date,
        frozen: { winner: rec.winner, log: rec.log ?? [] },
      });
    }
    const session = new BattleSession(rec.ownerId, rec.timeZone, rec.leadSlot, {
      id: rec.id,
      date: rec.date,
    });
    session.replaying = true;
    try {
      await session.ready();
      for (const choice of rec.choices) {
        const result = await session.applyChoice(choice);
        if (result.error) throw new Error(`stored choice "${choice}" rejected: ${result.error}`);
      }
    } catch (err) {
      session.destroy();
      throw err;
    } finally {
      session.replaying = false;
    }
    session.pendingLines = [];
    return session;
  }

  /** Wait until the battle has produced its first request (or ended). */
  async ready(): Promise<BattleSnapshot> {
    if (!this.currentRequest && !this.ended) {
      await this.waitForNextChange(this.version);
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
  history(): BattleHistory {
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
    void this.stream?.writeEnd().catch(() => {});
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
  try {
    store.insertSession({
      id: session.id,
      ownerId,
      date: session.date,
      timeZone,
      leadSlot,
    });
  } catch (err) {
    session.destroy();
    throw err;
  }
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
    store.deleteSession(evicted.id);
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

function register(session: BattleSession): void {
  sessions.set(session.id, session);
  let dated = byOwner.get(session.ownerId);
  if (!dated) {
    dated = new Map();
    byOwner.set(session.ownerId, dated);
  }
  dated.set(session.date, session);
}

/**
 * Opens the database and restores every stored battle. Call once at startup,
 * before accepting requests. A battle that can no longer be replayed is
 * logged and left in the database (not registered), so it is retried on the
 * next start.
 */
export async function restoreSessions(): Promise<void> {
  store.initStore();
  const version: string = require("pokemon-showdown/package.json").version;
  const previous = store.getMeta("showdown_version");
  if (previous && previous !== version) {
    console.warn(
      `pokemon-showdown changed (${previous} -> ${version}); replayed battles may diverge`
    );
  }
  store.setMeta("showdown_version", version);
  const records = store.loadAllSessions();
  let restored = 0;
  for (const rec of records) {
    try {
      register(await BattleSession.restore(rec));
      restored++;
    } catch (err) {
      console.error(`could not restore battle ${rec.id}`, err);
    }
  }
  console.log(`Restored ${restored}/${records.length} battle sessions`);
}

/** The user's streaks as of the given local date. */
export function streakFor(ownerId: string, date: string): StreakInfo {
  return store.getStreak(ownerId, date);
}
