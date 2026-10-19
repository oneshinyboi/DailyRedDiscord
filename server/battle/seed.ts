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

export function isValidTimeZone(timeZone: string): boolean {
  try {
    todayInTimeZone(timeZone);
    return true;
  } catch {
    return false;
  }
}

export interface DailySeeds {
  /** Calendar date the seeds are derived from (YYYY-MM-DD in the user's tz) */
  date: string;
  /** Seed for the challenger's team generation */
  teamSeed: PRNGSeed;
  /** Seed for the battle RNG itself */
  battleSeed: PRNGSeed;
  /** Seed for Red's AI */
  aiSeed: PRNGSeed;
}

/**
 * Derives the shared daily seeds: every user in the same timezone on the same
 * date faces the identical team, battle RNG, and Red AI sequence.
 */
export function dailySeeds(timeZone: string): DailySeeds {
  const date = todayInTimeZone(timeZone);
  const [a, b, c, d] = seedFromString(`dailyred|${date}`).split(",").map(Number);
  const rotate = (parts: number[]) => parts.join(",") as PRNGSeed;
  return {
    date,
    teamSeed: rotate([a, b, c, d]),
    battleSeed: rotate([b, c, d, a]),
    aiSeed: rotate([c, d, a, b]),
  };
}
