import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeStore,
  finishSession,
  getStreak,
  guildLeaderboard,
  initStore,
  insertSession,
  recordGuild,
} from "./store.js";

let nextId = 0;

function play(ownerId: string, date: string, won: boolean): void {
  const id = `s${nextId++}`;
  insertSession({ id, ownerId, date, timeZone: "UTC", leadSlot: 0 });
  finishSession({
    id,
    ownerId,
    date,
    winner: won ? "Challenger" : "Red",
    won,
    log: [],
  });
}

beforeEach(() => {
  process.env.DB_PATH = ":memory:";
  initStore();
});

afterEach(() => closeStore());

describe("streaks", () => {
  it("extends on consecutive days and resets after a gap", () => {
    play("u1", "2026-01-01", true);
    play("u1", "2026-01-02", true);
    expect(getStreak("u1", "2026-01-02")).toEqual({
      play: 2,
      bestPlay: 2,
      win: 2,
      bestWin: 2,
    });

    play("u1", "2026-01-05", true);
    expect(getStreak("u1", "2026-01-05")).toMatchObject({ play: 1, win: 1, bestWin: 2 });
  });

  it("resets the win streak on a loss but keeps the play streak", () => {
    play("u1", "2026-01-01", true);
    play("u1", "2026-01-02", false);
    expect(getStreak("u1", "2026-01-02")).toMatchObject({ play: 2, win: 0, bestWin: 1 });
  });

  it("treats a stale streak as expired when read later", () => {
    play("u1", "2026-01-01", true);
    expect(getStreak("u1", "2026-01-10")).toMatchObject({ play: 0, win: 0, bestPlay: 1 });
  });
});

describe("finishSession", () => {
  it("is idempotent", () => {
    insertSession({ id: "x", ownerId: "u1", date: "2026-01-01", timeZone: "UTC", leadSlot: 0 });
    const rec = {
      id: "x",
      ownerId: "u1",
      date: "2026-01-01",
      winner: "Challenger",
      won: true,
      log: [],
    };
    finishSession(rec);
    finishSession(rec);
    recordGuild("u1", "g1");
    expect(guildLeaderboard("g1")).toEqual([{ ownerId: "u1", games: 1, wins: 1 }]);
  });
});

describe("guildLeaderboard", () => {
  it("ranks by win rate and lists players under the minimum last", () => {
    // veteran: 3 games, 1 win (33%); newbie: 1 game, 1 win (100%); ace: 3 games, 3 wins
    for (const [owner, results] of [
      ["veteran", [true, false, false]],
      ["newbie", [true]],
      ["ace", [true, true, true]],
    ] as const) {
      recordGuild(owner, "g1");
      results.forEach((won, i) => play(owner, `2026-01-0${i + 1}`, won));
    }
    play("outsider", "2026-01-01", true);
    recordGuild("outsider", "g2");

    expect(guildLeaderboard("g1").map((e) => e.ownerId)).toEqual([
      "ace",
      "veteran",
      "newbie",
    ]);
  });
});
