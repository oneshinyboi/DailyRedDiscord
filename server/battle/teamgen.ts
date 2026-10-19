import ps from "pokemon-showdown";
import type { PokemonSet } from "pokemon-showdown/dist/sim/teams.js";
import type { PRNGSeed } from "pokemon-showdown/dist/sim/prng.js";

const { Teams } = ps;

export const PLAYER_LEVEL = 100;

/**
 * Generates the challenger's team for the day: a legal random gen 3 team
 * (the gen 3 dex covers every species from generations 1-3), with every
 * level forced to 100. Deterministic for a given seed.
 */
export function generateDailyTeam(seed: PRNGSeed): PokemonSet[] {
  const team = Teams.generate("gen3randombattle", { seed });
  for (const set of team) set.level = PLAYER_LEVEL;
  return team;
}
