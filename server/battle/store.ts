import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { StreakInfo } from "@dailyred/shared";
import { previousDay } from "./seed.js";

export interface SessionRecord {
  id: string;
  ownerId: string;
  date: string;
  timeZone: string;
  leadSlot: number;
  ended: boolean;
  winner: string | null;
  /** Final client-visible log; only stored once the battle has ended. */
  log: string[] | null;
  /** Accepted choices in order; replayed to rebuild an active battle. */
  choices: string[];
}

/** Players with fewer finished games than this rank after everyone else. */
export const MIN_RANKED_GAMES = 3;

export interface LeaderboardEntry {
  ownerId: string;
  games: number;
  wins: number;
}

interface PlayerRow {
  games_played: number;
  wins: number;
  play_streak: number;
  best_play_streak: number;
  win_streak: number;
  best_win_streak: number;
  last_played_date: string | null;
  last_win_date: string | null;
}

const EMPTY_PLAYER: PlayerRow = {
  games_played: 0,
  wins: 0,
  play_streak: 0,
  best_play_streak: 0,
  win_streak: 0,
  best_win_streak: 0,
  last_played_date: null,
  last_win_date: null,
};

let db: DatabaseSync;
let stmts: Record<string, StatementSync>;

/** Opens (creating if needed) the database. Call once before anything else. */
export function initStore(): void {
  const path = process.env.DB_PATH ?? "data/dailyred.sqlite";
  mkdirSync(dirname(path), { recursive: true });
  db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      date TEXT NOT NULL,
      time_zone TEXT NOT NULL,
      lead_slot INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      ended INTEGER NOT NULL DEFAULT 0,
      winner TEXT,
      log TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS sessions_owner_date ON sessions (owner_id, date);
    CREATE TABLE IF NOT EXISTS choices (
      session_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      choice TEXT NOT NULL,
      PRIMARY KEY (session_id, seq)
    );
    CREATE TABLE IF NOT EXISTS players (
      owner_id TEXT PRIMARY KEY,
      games_played INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      play_streak INTEGER NOT NULL DEFAULT 0,
      best_play_streak INTEGER NOT NULL DEFAULT 0,
      win_streak INTEGER NOT NULL DEFAULT 0,
      best_win_streak INTEGER NOT NULL DEFAULT 0,
      last_played_date TEXT,
      last_win_date TEXT
    );
    CREATE TABLE IF NOT EXISTS user_guilds (
      owner_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      PRIMARY KEY (owner_id, guild_id)
    );
    CREATE INDEX IF NOT EXISTS user_guilds_guild ON user_guilds (guild_id);
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  migrateLegacyStreaks();
  stmts = {
    insertSession: db.prepare(
      `INSERT INTO sessions (id, owner_id, date, time_zone, lead_slot, created_at)
       VALUES ($id, $ownerId, $date, $timeZone, $leadSlot, $createdAt)`
    ),
    appendChoice: db.prepare(
      `INSERT INTO choices (session_id, seq, choice)
       SELECT $id, COALESCE(MAX(seq), -1) + 1, $choice FROM choices WHERE session_id = $id`
    ),
    finish: db.prepare(
      `UPDATE sessions SET ended = 1, winner = $winner, log = $log
       WHERE id = $id AND ended = 0`
    ),
    deleteChoices: db.prepare(`DELETE FROM choices WHERE session_id = $id`),
    deleteSession: db.prepare(`DELETE FROM sessions WHERE id = $id`),
    sessionById: db.prepare(`SELECT * FROM sessions WHERE id = $id`),
    sessionByOwnerDate: db.prepare(
      `SELECT * FROM sessions WHERE owner_id = $ownerId AND date = $date`
    ),
    choicesFor: db.prepare(
      `SELECT choice FROM choices WHERE session_id = $id ORDER BY seq`
    ),
    staleSessions: db.prepare(
      `SELECT id FROM sessions WHERE owner_id = $ownerId
       ORDER BY date DESC LIMIT -1 OFFSET $keep`
    ),
    getPlayer: db.prepare(`SELECT * FROM players WHERE owner_id = $ownerId`),
    putPlayer: db.prepare(
      `INSERT INTO players (owner_id, games_played, wins, play_streak, best_play_streak,
                            win_streak, best_win_streak, last_played_date, last_win_date)
       VALUES ($ownerId, $games_played, $wins, $play_streak, $best_play_streak,
               $win_streak, $best_win_streak, $last_played_date, $last_win_date)
       ON CONFLICT (owner_id) DO UPDATE SET
         games_played = excluded.games_played,
         wins = excluded.wins,
         play_streak = excluded.play_streak,
         best_play_streak = excluded.best_play_streak,
         win_streak = excluded.win_streak,
         best_win_streak = excluded.best_win_streak,
         last_played_date = excluded.last_played_date,
         last_win_date = excluded.last_win_date`
    ),
    addGuild: db.prepare(
      `INSERT OR IGNORE INTO user_guilds (owner_id, guild_id) VALUES ($ownerId, $guildId)`
    ),
    leaderboard: db.prepare(
      `SELECT p.owner_id, p.games_played, p.wins
       FROM players p JOIN user_guilds g ON g.owner_id = p.owner_id
       WHERE g.guild_id = $guildId AND p.games_played > 0
       ORDER BY (p.games_played >= $minGames) DESC,
                CAST(p.wins AS REAL) / p.games_played DESC,
                p.games_played DESC,
                p.owner_id
       LIMIT $limit`
    ),
    getMeta: db.prepare(`SELECT value FROM meta WHERE key = $key`),
    putMeta: db.prepare(
      `INSERT INTO meta (key, value) VALUES ($key, $value)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`
    ),
  };
}

/**
 * Earlier versions kept streaks in a `streaks` table without game totals.
 * Carry those rows over and rebuild the totals from sessions still stored.
 */
function migrateLegacyStreaks(): void {
  const legacy = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'streaks'`)
    .get();
  if (!legacy) return;
  transaction(() => {
    db.exec(`
      INSERT OR IGNORE INTO players (owner_id, play_streak, best_play_streak,
                                     win_streak, best_win_streak,
                                     last_played_date, last_win_date)
        SELECT owner_id, play_streak, best_play_streak, win_streak,
               best_win_streak, last_played_date, last_win_date FROM streaks;
      UPDATE players SET
        games_played = (SELECT COUNT(*) FROM sessions s
                        WHERE s.owner_id = players.owner_id AND s.ended = 1),
        wins = (SELECT COUNT(*) FROM sessions s
                WHERE s.owner_id = players.owner_id AND s.ended = 1
                  AND s.winner = 'Challenger');
      DROP TABLE streaks;
    `);
  });
}

function transaction<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

function readPlayer(ownerId: string): PlayerRow {
  return (stmts.getPlayer.get({ ownerId }) as PlayerRow | undefined) ?? EMPTY_PLAYER;
}

function writePlayer(ownerId: string, row: PlayerRow): void {
  stmts.putPlayer.run({
    ownerId,
    games_played: row.games_played,
    wins: row.wins,
    play_streak: row.play_streak,
    best_play_streak: row.best_play_streak,
    win_streak: row.win_streak,
    best_win_streak: row.best_win_streak,
    last_played_date: row.last_played_date,
    last_win_date: row.last_win_date,
  });
}

/** Persists a freshly begun battle and counts the day toward the play streak. */
export function insertSession(rec: {
  id: string;
  ownerId: string;
  date: string;
  timeZone: string;
  leadSlot: number;
}): void {
  transaction(() => {
    stmts.insertSession.run({ ...rec, createdAt: Date.now() });
    const row = readPlayer(rec.ownerId);
    if (row.last_played_date === rec.date) return;
    const play = row.last_played_date === previousDay(rec.date) ? row.play_streak + 1 : 1;
    writePlayer(rec.ownerId, {
      ...row,
      play_streak: play,
      best_play_streak: Math.max(row.best_play_streak, play),
      last_played_date: rec.date,
    });
  });
}

export function appendChoice(id: string, choice: string): void {
  stmts.appendChoice.run({ id, choice });
}

/**
 * Marks a battle as concluded and updates the win streak. Idempotent: a
 * session that is already ended (or was evicted) changes nothing.
 */
export function finishSession(rec: {
  id: string;
  ownerId: string;
  date: string;
  winner: string | null;
  won: boolean;
  log: string[];
}): void {
  transaction(() => {
    const { changes } = stmts.finish.run({
      id: rec.id,
      winner: rec.winner,
      log: JSON.stringify(rec.log),
    });
    if (Number(changes) === 0) return;
    const row = readPlayer(rec.ownerId);
    const totals = {
      ...row,
      games_played: row.games_played + 1,
      wins: row.wins + (rec.won ? 1 : 0),
    };
    if (!rec.won) {
      writePlayer(rec.ownerId, { ...totals, win_streak: 0 });
      return;
    }
    const win = row.last_win_date === previousDay(rec.date) ? row.win_streak + 1 : 1;
    writePlayer(rec.ownerId, {
      ...totals,
      win_streak: win,
      best_win_streak: Math.max(row.best_win_streak, win),
      last_win_date: rec.date,
    });
  });
}

/** Removes a battle's data. Streaks are kept. */
export function deleteSession(id: string): void {
  transaction(() => {
    stmts.deleteChoices.run({ id });
    stmts.deleteSession.run({ id });
  });
}

function toRecord(row: Record<string, any>): SessionRecord {
  const choices = (stmts.choicesFor.all({ id: row.id }) as { choice: string }[]).map(
    (c) => c.choice
  );
  return {
    id: row.id,
    ownerId: row.owner_id,
    date: row.date,
    timeZone: row.time_zone,
    leadSlot: row.lead_slot,
    ended: row.ended === 1,
    winner: row.winner,
    log: row.log ? JSON.parse(row.log) : null,
    choices,
  };
}

export function findSessionById(id: string): SessionRecord | undefined {
  const row = stmts.sessionById.get({ id });
  return row ? toRecord(row) : undefined;
}

export function findSessionByOwnerDate(
  ownerId: string,
  date: string
): SessionRecord | undefined {
  const row = stmts.sessionByOwnerDate.get({ ownerId, date });
  return row ? toRecord(row) : undefined;
}

/** Deletes all but the user's `keep` newest-dated sessions; returns the ids removed. */
export function evictOldSessions(ownerId: string, keep: number): string[] {
  return transaction(() => {
    const ids = (stmts.staleSessions.all({ ownerId, keep }) as { id: string }[]).map(
      (r) => r.id
    );
    for (const id of ids) {
      stmts.deleteChoices.run({ id });
      stmts.deleteSession.run({ id });
    }
    return ids;
  });
}

/** Remembers that the user plays in this guild. Idempotent. */
export function recordGuild(ownerId: string, guildId: string): void {
  stmts.addGuild.run({ ownerId, guildId });
}

/**
 * Top players who have played from the guild, by win rate. Players with
 * fewer than MIN_RANKED_GAMES finished games follow everyone else, ordered
 * among themselves by the same rule (win rate, then more games).
 */
export function guildLeaderboard(guildId: string, limit = 10): LeaderboardEntry[] {
  const rows = stmts.leaderboard.all({
    guildId,
    minGames: MIN_RANKED_GAMES,
    limit,
  }) as { owner_id: string; games_played: number; wins: number }[];
  return rows.map((r) => ({ ownerId: r.owner_id, games: r.games_played, wins: r.wins }));
}

/**
 * The user's streaks as seen on `refDate`. A current streak is only alive
 * if it was last extended on refDate or the day before; best values never
 * expire.
 */
export function getStreak(ownerId: string, refDate: string): StreakInfo {
  const row = readPlayer(ownerId);
  const cutoff = previousDay(refDate);
  const playAlive = row.last_played_date !== null && row.last_played_date >= cutoff;
  const winAlive = row.last_win_date !== null && row.last_win_date >= cutoff;
  return {
    play: playAlive ? row.play_streak : 0,
    bestPlay: row.best_play_streak,
    win: winAlive ? row.win_streak : 0,
    bestWin: row.best_win_streak,
  };
}

export function getMeta(key: string): string | undefined {
  return (stmts.getMeta.get({ key }) as { value: string } | undefined)?.value;
}

export function setMeta(key: string, value: string): void {
  stmts.putMeta.run({ key, value });
}

export function closeStore(): void {
  db?.close();
}

/**
 * Writes a consistent copy of the database into `dir` (named by timestamp)
 * and keeps only the newest `keep` copies. Skipped if the newest copy is
 * younger than `minAgeMs`, so frequent restarts don't churn the backups.
 */
export function backupDatabase(dir: string, keep: number, minAgeMs: number): string | null {
  mkdirSync(dir, { recursive: true });
  const existing = readdirSync(dir)
    .filter((f) => /^dailyred-.*\.sqlite$/.test(f))
    .sort();
  const newest = existing[existing.length - 1];
  if (newest && Date.now() - statSync(join(dir, newest)).mtimeMs < minAgeMs) return null;

  const name = `dailyred-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`;
  db.prepare("VACUUM INTO ?").run(join(dir, name));
  for (const old of [...existing, name].sort().slice(0, -keep)) {
    rmSync(join(dir, old), { force: true });
  }
  return name;
}
