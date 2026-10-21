import { PRNGSeed } from "pokemon-showdown/dist/sim/prng.js";

/**
 * cyrb128 string hash -> 4 x 32-bit ints, rendered as a PRNG seed string
 * ("a,b,c,d"). Same input always yields the same seed, so everyone sharing
 * a date string gets the identical battle.
 */
export function seedFromString(input: string): PRNGSeed {
  let h1 = 0x1779033703;
  let h2 = 0x3144134277;
  let h3 = 0x1013904242;
  let h4 = 0x2773480762;
  for (let i = 0; i < input.length; i++) {
    const k = input.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  const mix = (h: number) => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
  return [mix(h1), mix(h2), mix(h3), mix(h4)].join(",") as PRNGSeed;
}

/** Returns today's calendar date (YYYY-MM-DD) in the given IANA timezone. */
export function todayInTimeZone(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
}

/** The calendar date (YYYY-MM-DD) before the given one. */
export function previousDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    todayInTimeZone(timeZone);
    return true;
  } catch {
    return false;
  }
}

/**
 * Red's strength ranges over [MIN_DIFFICULTY, MAX_DIFFICULTY] by day (see
 * ai/redbot.py: 0 plays near random, 1 is full-strength Foul Play).
 */
export const MIN_DIFFICULTY = 0.75;
export const MAX_DIFFICULTY = 1;

export interface DailySeeds {
  /** Calendar date the seeds are derived from (YYYY-MM-DD in the user's tz) */
  date: string;
  /** Seed for the challenger's team generation */
  teamSeed: PRNGSeed;
  /** Seed for the battle RNG itself */
  battleSeed: PRNGSeed;
  /** Seed for the original random AI (and Foul Play's move sampling) */
  aiSeed: PRNGSeed;
  /** How well Red plays today, from MIN_DIFFICULTY to MAX_DIFFICULTY */
  difficulty: number;
}

/**
 * Derives the shared daily seeds: every user in the same timezone on the same
 * date faces the identical team, battle RNG, and Red difficulty.
 */
export function dailySeeds(timeZone: string): DailySeeds {
  return dailySeedsForDate(todayInTimeZone(timeZone));
}

/** Same seeds for an explicit date, so stored battles can be rebuilt later. */
export function dailySeedsForDate(date: string): DailySeeds {
  const [a, b, c, d] = seedFromString(`dailyred|${date}`).split(",").map(Number);
  const rotate = (parts: number[]) => parts.join(",") as PRNGSeed;
  return {
    date,
    teamSeed: rotate([a, b, c, d]),
    battleSeed: rotate([b, c, d, a]),
    aiSeed: rotate([c, d, a, b]),
    difficulty: MIN_DIFFICULTY + (d / 2 ** 32) * (MAX_DIFFICULTY - MIN_DIFFICULTY),
  };
}
